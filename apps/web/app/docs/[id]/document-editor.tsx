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
    <main className="editorPage">
      <header className="editorHeader">
        <div className="editorTitleWrap">
          <Link href="/" className="backLink">
            Back
          </Link>
          <input
            className="titleInput"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Untitled document"
          />
        </div>
        <div className="editorActions">
          <button
            className="shareButton"
            type="button"
            onClick={() => setIsShareOpen((value) => !value)}
          >
            {isShareOpen ? "Close" : "Share"}
          </button>
          <p className="saveStatus">{statusLabel}</p>
        </div>
      </header>

      {isShareOpen ? (
        <section className="shareCard">
          <div className="shareCardHeader">
            <h2>Share settings</h2>
            {isMembersLoading ? (
              <span className="muted">Loading...</span>
            ) : null}
          </div>

          {membersError ? <p className="errorText">{membersError}</p> : null}

          {owner ? (
            <div className="shareOwnerRow">
              <div>
                <p className="shareName">{formatName(owner.user)}</p>
                <p className="muted">{owner.user.email}</p>
              </div>
              <span className="rolePill">OWNER</span>
            </div>
          ) : null}

          <ul className="shareMemberList">
            {members.map((member) => {
              const isBusy = memberAction?.memberId === member.id;

              return (
                <li className="shareMemberRow" key={member.id}>
                  <div>
                    <p className="shareName">{formatName(member.user)}</p>
                    <p className="muted">{member.user.email}</p>
                  </div>

                  {canManageMembers ? (
                    <div className="shareMemberControls">
                      <select
                        className="shareSelect"
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
                        className="dangerButton"
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
                    <span className="rolePill">{member.role}</span>
                  )}
                </li>
              );
            })}
          </ul>

          {!isMembersLoading && members.length === 0 ? (
            <p className="muted">No shared members yet.</p>
          ) : null}

          {canManageMembers ? (
            <form className="shareInviteForm" onSubmit={handleInviteSubmit}>
              <div className="shareInviteRow">
                <input
                  className="shareInput"
                  type="email"
                  placeholder="teammate@company.com"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                />

                <select
                  className="shareSelect"
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
                  className="primaryButton smallButton"
                  type="submit"
                  disabled={inviteStatus === "submitting"}
                >
                  {inviteStatus === "submitting" ? "Inviting..." : "Invite"}
                </button>
              </div>

              {inviteMessage ? (
                <p
                  className={
                    inviteStatus === "error" ? "errorText" : "statusText"
                  }
                >
                  {inviteMessage}
                </p>
              ) : null}
            </form>
          ) : (
            <p className="muted">Only the owner can change sharing settings.</p>
          )}
        </section>
      ) : null}

      <section className="editorCard">
        <textarea
          className="editorTextarea"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Start typing your document..."
        />
      </section>
    </main>
  );
}
