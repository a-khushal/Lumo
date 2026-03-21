"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type DocumentEditorProps = {
  documentId: string;
  currentUserId: string;
  initialTitle: string;
  initialText: string;
  updatedAt: string;
};

type SaveState = "saved" | "saving" | "error";
type InviteRole = "EDITOR" | "COMMENTER" | "VIEWER";

type MemberUser = {
  id: string;
  email: string;
  name: string | null;
};

type OwnerResponse = {
  role: "OWNER";
  user: MemberUser;
};

type MemberResponse = {
  id: string;
  role: InviteRole;
  createdAt: string;
  user: MemberUser;
};

type MembersResponse = {
  owner: OwnerResponse;
  members: MemberResponse[];
};

type MemberMutationResponse = {
  member: MemberResponse;
};

type ApiError = {
  error?: string;
};

type InviteStatus = "idle" | "submitting" | "error" | "success";

const formatUpdatedAt = (updatedAt: string) => {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(updatedAt));
};

const parseApiError = async (response: Response) => {
  try {
    const data = (await response.json()) as ApiError;
    return data.error ?? "Request failed";
  } catch {
    return "Request failed";
  }
};

const memberRoleOptions: InviteRole[] = ["EDITOR", "COMMENTER", "VIEWER"];

const formatName = (user: MemberUser) => {
  if (user.name && user.name.trim().length > 0) {
    return user.name;
  }

  return user.email;
};

export function DocumentEditor({
  documentId,
  currentUserId,
  initialTitle,
  initialText,
  updatedAt,
}: DocumentEditorProps) {
  const [title, setTitle] = useState(initialTitle);
  const [text, setText] = useState(initialText);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [lastSavedAt, setLastSavedAt] = useState(updatedAt);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isMembersLoading, setIsMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [owner, setOwner] = useState<OwnerResponse | null>(null);
  const [members, setMembers] = useState<MemberResponse[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<InviteRole>("EDITOR");
  const [inviteStatus, setInviteStatus] = useState<InviteStatus>("idle");
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);
  const [memberAction, setMemberAction] = useState<{
    memberId: string;
    type: "updating-role" | "removing";
  } | null>(null);
  const lastPayloadRef = useRef(
    JSON.stringify({ title: initialTitle, content: { text: initialText } }),
  );

  const canManageMembers = owner?.user.id === currentUserId;

  const loadMembers = useCallback(async () => {
    setIsMembersLoading(true);
    setMembersError(null);

    try {
      const response = await fetch(`/api/docs/${documentId}/members`);

      if (!response.ok) {
        throw new Error(await parseApiError(response));
      }

      const data = (await response.json()) as MembersResponse;
      setOwner(data.owner);
      setMembers(data.members);
    } catch (error) {
      setMembersError(
        error instanceof Error ? error.message : "Failed to load members",
      );
    } finally {
      setIsMembersLoading(false);
    }
  }, [documentId]);

  const statusLabel = useMemo(() => {
    if (saveState === "saving") {
      return "Saving...";
    }

    if (saveState === "error") {
      return "Save failed";
    }

    return `Saved ${formatUpdatedAt(lastSavedAt)}`;
  }, [lastSavedAt, saveState]);

  useEffect(() => {
    if (!isShareOpen) {
      return;
    }

    void loadMembers();
  }, [isShareOpen, loadMembers]);

  useEffect(() => {
    const payload = JSON.stringify({
      title: title.trim() || "Untitled document",
      content: { text },
    });

    if (payload === lastPayloadRef.current) {
      return;
    }

    setSaveState("saving");

    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/docs/${documentId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: payload,
        });

        if (!response.ok) {
          throw new Error("Failed to save document");
        }

        const data = (await response.json()) as { updatedAt?: string };
        lastPayloadRef.current = payload;
        setSaveState("saved");

        if (data.updatedAt) {
          setLastSavedAt(data.updatedAt);
        }
      } catch {
        setSaveState("error");
      }
    }, 900);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [documentId, text, title]);

  const handleInviteSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();

    if (!canManageMembers) {
      return;
    }

    const email = inviteEmail.trim().toLowerCase();

    if (!email) {
      setInviteStatus("error");
      setInviteMessage("Email is required");
      return;
    }

    setInviteStatus("submitting");
    setInviteMessage(null);

    try {
      const response = await fetch(`/api/docs/${documentId}/members`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          role: inviteRole,
        }),
      });

      if (!response.ok) {
        throw new Error(await parseApiError(response));
      }

      setInviteEmail("");
      setInviteStatus("success");
      setInviteMessage("Access updated");
      await loadMembers();
    } catch (error) {
      setInviteStatus("error");
      setInviteMessage(
        error instanceof Error ? error.message : "Failed to share document",
      );
    }
  };

  const handleRoleChange = async (memberId: string, role: InviteRole) => {
    if (!canManageMembers) {
      return;
    }

    setMemberAction({ memberId, type: "updating-role" });

    try {
      const response = await fetch(
        `/api/docs/${documentId}/members/${memberId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ role }),
        },
      );

      if (!response.ok) {
        throw new Error(await parseApiError(response));
      }

      const data = (await response.json()) as MemberMutationResponse;

      setMembers((prev) =>
        prev.map((member) => (member.id === memberId ? data.member : member)),
      );
    } catch (error) {
      setMembersError(
        error instanceof Error ? error.message : "Failed to update role",
      );
    } finally {
      setMemberAction(null);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!canManageMembers) {
      return;
    }

    setMemberAction({ memberId, type: "removing" });

    try {
      const response = await fetch(
        `/api/docs/${documentId}/members/${memberId}`,
        {
          method: "DELETE",
        },
      );

      if (!response.ok) {
        throw new Error(await parseApiError(response));
      }

      setMembers((prev) => prev.filter((member) => member.id !== memberId));
    } catch (error) {
      setMembersError(
        error instanceof Error ? error.message : "Failed to remove member",
      );
    } finally {
      setMemberAction(null);
    }
  };

  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-12 pt-10 sm:px-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center sm:gap-4">
          <Link
            href="/"
            className="text-sm font-medium text-muted hover:text-ink"
          >
            Back
          </Link>
          <input
            className="w-full rounded-xl border border-border bg-panel px-3 py-2 text-sm text-ink shadow-sm outline-none ring-accent/40 transition focus:ring-2 sm:w-[min(66vw,540px)]"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Untitled document"
          />
        </div>
        <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-end">
          <button
            className="rounded-full border border-border bg-panel px-4 py-2 text-sm font-medium text-ink transition hover:bg-slate-50"
            type="button"
            onClick={() => setIsShareOpen((value) => !value)}
          >
            {isShareOpen ? "Close" : "Share"}
          </button>
          <p className="text-sm text-muted">{statusLabel}</p>
        </div>
      </header>

      {isShareOpen ? (
        <section className="mt-4 rounded-2xl border border-border bg-panel p-4 shadow-card">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-ink">Share settings</h2>
            {isMembersLoading ? (
              <span className="text-sm text-muted">Loading...</span>
            ) : null}
          </div>

          {membersError ? (
            <p className="mb-3 text-sm font-medium text-rose-700">
              {membersError}
            </p>
          ) : null}

          {owner ? (
            <div className="mb-3 flex flex-col gap-3 rounded-xl border border-border bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold text-ink">
                  {formatName(owner.user)}
                </p>
                <p className="text-sm text-muted">{owner.user.email}</p>
              </div>
              <span className="w-fit rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-accent-strong">
                OWNER
              </span>
            </div>
          ) : null}

          <ul className="grid gap-2">
            {members.map((member) => {
              const isBusy = memberAction?.memberId === member.id;

              return (
                <li
                  className="flex flex-col gap-3 rounded-xl border border-border bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between"
                  key={member.id}
                >
                  <div>
                    <p className="font-semibold text-ink">
                      {formatName(member.user)}
                    </p>
                    <p className="text-sm text-muted">{member.user.email}</p>
                  </div>

                  {canManageMembers ? (
                    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                      <select
                        className="rounded-lg border border-border bg-panel px-3 py-2 text-sm text-ink outline-none ring-accent/40 focus:ring-2"
                        value={member.role}
                        disabled={isBusy}
                        onChange={(event) => {
                          void handleRoleChange(
                            member.id,
                            event.target.value as InviteRole,
                          );
                        }}
                      >
                        {memberRoleOptions.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>

                      <button
                        className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                        type="button"
                        disabled={isBusy}
                        onClick={() => {
                          void handleRemoveMember(member.id);
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <span className="w-fit rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-accent-strong">
                      {member.role}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>

          {!isMembersLoading && members.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No shared members yet.</p>
          ) : null}

          {canManageMembers ? (
            <form className="mt-4 grid gap-2" onSubmit={handleInviteSubmit}>
              <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                <input
                  className="rounded-lg border border-border bg-panel px-3 py-2 text-sm text-ink outline-none ring-accent/40 focus:ring-2"
                  type="email"
                  placeholder="teammate@company.com"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                />

                <select
                  className="rounded-lg border border-border bg-panel px-3 py-2 text-sm text-ink outline-none ring-accent/40 focus:ring-2"
                  value={inviteRole}
                  onChange={(event) =>
                    setInviteRole(event.target.value as InviteRole)
                  }
                >
                  {memberRoleOptions.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>

                <button
                  className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
                  type="submit"
                  disabled={inviteStatus === "submitting"}
                >
                  {inviteStatus === "submitting" ? "Inviting..." : "Invite"}
                </button>
              </div>

              {inviteMessage ? (
                <p
                  className={
                    inviteStatus === "error"
                      ? "text-sm font-medium text-rose-700"
                      : "text-sm font-medium text-accent-strong"
                  }
                >
                  {inviteMessage}
                </p>
              ) : null}
            </form>
          ) : (
            <p className="mt-3 text-sm text-muted">
              Only the owner can change sharing settings.
            </p>
          )}
        </section>
      ) : null}

      <section className="mt-5 overflow-hidden rounded-2xl border border-border bg-panel shadow-card">
        <textarea
          className="min-h-[66vh] w-full resize-y border-0 bg-transparent p-4 text-base leading-relaxed text-ink outline-none"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Start typing your document..."
        />
      </section>
    </main>
  );
}
