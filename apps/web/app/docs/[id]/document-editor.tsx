"use client";

import Link from "next/link";
import StarterKit from "@tiptap/starter-kit";
import { EditorContent, useEditor } from "@tiptap/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type DocumentEditorProps = {
  documentId: string;
  currentUserId: string;
  currentUserRole: DocumentRole;
  initialTitle: string;
  initialContent: unknown;
  updatedAt: string;
};

type SaveState = "saved" | "saving" | "error";
type InviteRole = "EDITOR" | "COMMENTER" | "VIEWER";
type DocumentRole = "OWNER" | InviteRole;

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

type SnapshotResponse = {
  id: string;
  version: number;
  createdAt: string;
  createdBy: MemberUser | null;
};

type SnapshotsResponse = {
  snapshots: SnapshotResponse[];
};

type SnapshotMutationResponse = {
  snapshot: SnapshotResponse;
};

type RestoreSnapshotResponse = {
  restoredFromVersion: number;
  document: {
    title: string;
    content: unknown;
    updatedAt: string;
  };
  snapshot: SnapshotResponse;
};

type ApiError = {
  error?: string;
};

type InviteStatus = "idle" | "submitting" | "error" | "success";
type EditorDoc = Record<string, unknown>;

const emptyDoc: EditorDoc = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

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

const toParagraphDoc = (text: string) => {
  const normalizedText = text.trim();

  if (!normalizedText) {
    return emptyDoc;
  }

  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: normalizedText }],
      },
    ],
  } satisfies EditorDoc;
};

const normalizeEditorContent = (value: unknown): EditorDoc => {
  if (typeof value === "string") {
    return toParagraphDoc(value);
  }

  if (value && typeof value === "object") {
    if ("type" in value && value.type === "doc") {
      return value as EditorDoc;
    }

    if ("text" in value && typeof value.text === "string") {
      return toParagraphDoc(value.text);
    }
  }

  return emptyDoc;
};

export function DocumentEditor({
  documentId,
  currentUserId,
  currentUserRole,
  initialTitle,
  initialContent,
  updatedAt,
}: DocumentEditorProps) {
  const startingContent = useMemo(
    () => normalizeEditorContent(initialContent),
    [initialContent],
  );
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState<EditorDoc>(startingContent);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [lastSavedAt, setLastSavedAt] = useState(updatedAt);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isMembersLoading, setIsMembersLoading] = useState(false);
  const [isSnapshotsLoading, setIsSnapshotsLoading] = useState(false);
  const [isCreatingSnapshot, setIsCreatingSnapshot] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [snapshotsError, setSnapshotsError] = useState<string | null>(null);
  const [owner, setOwner] = useState<OwnerResponse | null>(null);
  const [members, setMembers] = useState<MemberResponse[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotResponse[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<InviteRole>("EDITOR");
  const [inviteStatus, setInviteStatus] = useState<InviteStatus>("idle");
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);
  const [memberAction, setMemberAction] = useState<{
    memberId: string;
    type: "updating-role" | "removing";
  } | null>(null);
  const [snapshotActionId, setSnapshotActionId] = useState<string | null>(null);
  const lastPayloadRef = useRef(
    JSON.stringify({ title: initialTitle, content: startingContent }),
  );

  const canManageMembers = owner?.user.id === currentUserId;
  const canEdit = currentUserRole === "OWNER" || currentUserRole === "EDITOR";

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2],
        },
      }),
    ],
    editable: canEdit,
    content: startingContent,
    editorProps: {
      attributes: {
        class:
          "min-h-[66vh] w-full border-0 bg-transparent p-4 text-base leading-relaxed text-ink outline-none [&_h1]:mb-3 [&_h1]:text-3xl [&_h1]:font-semibold [&_h2]:mb-3 [&_h2]:text-2xl [&_h2]:font-semibold [&_p]:mb-3 [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-6",
      },
    },
    onUpdate({
      editor: currentEditor,
    }: {
      editor: { getJSON: () => unknown };
    }) {
      setContent(currentEditor.getJSON() as EditorDoc);
    },
  });

  useEffect(() => {
    editor?.setEditable(canEdit);
  }, [canEdit, editor]);

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

  const loadSnapshots = useCallback(async () => {
    setIsSnapshotsLoading(true);
    setSnapshotsError(null);

    try {
      const response = await fetch(`/api/docs/${documentId}/snapshots`);

      if (!response.ok) {
        throw new Error(await parseApiError(response));
      }

      const data = (await response.json()) as SnapshotsResponse;
      setSnapshots(data.snapshots);
    } catch (error) {
      setSnapshotsError(
        error instanceof Error ? error.message : "Failed to load versions",
      );
    } finally {
      setIsSnapshotsLoading(false);
    }
  }, [documentId]);

  const statusLabel = useMemo(() => {
    if (!canEdit) {
      return `Read-only (${currentUserRole})`;
    }

    if (saveState === "saving") {
      return "Saving...";
    }

    if (saveState === "error") {
      return "Save failed";
    }

    return `Saved ${formatUpdatedAt(lastSavedAt)}`;
  }, [canEdit, currentUserRole, lastSavedAt, saveState]);

  useEffect(() => {
    if (!isShareOpen) {
      return;
    }

    void loadMembers();
  }, [isShareOpen, loadMembers]);

  useEffect(() => {
    if (!isHistoryOpen) {
      return;
    }

    void loadSnapshots();
  }, [isHistoryOpen, loadSnapshots]);

  useEffect(() => {
    if (!canEdit) {
      return;
    }

    const payload = JSON.stringify({
      title: title.trim() || "Untitled document",
      content,
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
  }, [canEdit, content, documentId, title]);

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

  const handleCreateSnapshot = async () => {
    if (!canEdit) {
      return;
    }

    setIsCreatingSnapshot(true);
    setSnapshotsError(null);

    try {
      const response = await fetch(`/api/docs/${documentId}/snapshots`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(await parseApiError(response));
      }

      const data = (await response.json()) as SnapshotMutationResponse;

      setSnapshots((prev) => {
        const next = [data.snapshot, ...prev];
        const deduped = next.filter(
          (snapshot, index) =>
            next.findIndex((item) => item.id === snapshot.id) === index,
        );

        return deduped;
      });
    } catch (error) {
      setSnapshotsError(
        error instanceof Error ? error.message : "Failed to save version",
      );
    } finally {
      setIsCreatingSnapshot(false);
    }
  };

  const handleRestoreSnapshot = async (snapshot: SnapshotResponse) => {
    if (!canEdit) {
      return;
    }

    setSnapshotActionId(snapshot.id);
    setSnapshotsError(null);

    try {
      const response = await fetch(
        `/api/docs/${documentId}/snapshots/${snapshot.id}/restore`,
        {
          method: "POST",
        },
      );

      if (!response.ok) {
        throw new Error(await parseApiError(response));
      }

      const data = (await response.json()) as RestoreSnapshotResponse;
      const nextContent = normalizeEditorContent(data.document.content);
      const nextTitle = data.document.title;
      const nextPayload = JSON.stringify({
        title: nextTitle.trim() || "Untitled document",
        content: nextContent,
      });

      lastPayloadRef.current = nextPayload;
      setTitle(nextTitle);
      setContent(nextContent);
      editor?.commands.setContent(nextContent, false);
      setSaveState("saved");
      setLastSavedAt(data.document.updatedAt);

      setSnapshots((prev) => {
        const next = [data.snapshot, ...prev];
        const deduped = next.filter(
          (item, index) =>
            next.findIndex((row) => row.id === item.id) === index,
        );

        return deduped;
      });
    } catch (error) {
      setSnapshotsError(
        error instanceof Error ? error.message : "Failed to restore version",
      );
    } finally {
      setSnapshotActionId(null);
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
            className="w-full rounded-xl border border-border bg-panel px-3 py-2 text-sm text-ink shadow-sm outline-none ring-accent/40 transition focus:ring-2 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-muted sm:w-[min(66vw,540px)]"
            disabled={!canEdit}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Untitled document"
          />
        </div>
        <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-end">
          <div className="flex items-center gap-2">
            <button
              className="rounded-full border border-border bg-panel px-4 py-2 text-sm font-medium text-ink transition hover:bg-slate-50"
              type="button"
              onClick={() => setIsHistoryOpen((value) => !value)}
            >
              {isHistoryOpen ? "Close history" : "History"}
            </button>
            <button
              className="rounded-full border border-border bg-panel px-4 py-2 text-sm font-medium text-ink transition hover:bg-slate-50"
              type="button"
              onClick={() => setIsShareOpen((value) => !value)}
            >
              {isShareOpen ? "Close" : "Share"}
            </button>
          </div>
          <p className="text-sm text-muted">{statusLabel}</p>
        </div>
      </header>

      {!canEdit ? (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700">
          You have {currentUserRole} access. Editing is disabled.
        </p>
      ) : null}

      {isHistoryOpen ? (
        <section className="mt-4 rounded-2xl border border-border bg-panel p-4 shadow-card">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-ink">
                Version history
              </h2>
              <p className="text-sm text-muted">
                Restore older versions when needed.
              </p>
            </div>

            {canEdit ? (
              <button
                className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
                type="button"
                onClick={() => {
                  void handleCreateSnapshot();
                }}
                disabled={isCreatingSnapshot}
              >
                {isCreatingSnapshot ? "Saving..." : "Save version"}
              </button>
            ) : null}
          </div>

          {isSnapshotsLoading ? (
            <p className="text-sm text-muted">Loading versions...</p>
          ) : null}

          {snapshotsError ? (
            <p className="mb-3 text-sm font-medium text-rose-700">
              {snapshotsError}
            </p>
          ) : null}

          <ul className="grid gap-2">
            {snapshots.map((snapshot) => {
              const isRestoring = snapshotActionId === snapshot.id;

              return (
                <li
                  className="flex flex-col gap-2 rounded-xl border border-border bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between"
                  key={snapshot.id}
                >
                  <div>
                    <p className="font-semibold text-ink">
                      Version {snapshot.version}
                    </p>
                    <p className="text-sm text-muted">
                      {formatUpdatedAt(snapshot.createdAt)}
                      {snapshot.createdBy
                        ? ` by ${formatName(snapshot.createdBy)}`
                        : ""}
                    </p>
                  </div>

                  {canEdit ? (
                    <button
                      className="rounded-lg border border-border bg-panel px-3 py-2 text-sm font-medium text-ink transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                      type="button"
                      disabled={isRestoring}
                      onClick={() => {
                        void handleRestoreSnapshot(snapshot);
                      }}
                    >
                      {isRestoring ? "Restoring..." : "Restore"}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>

          {!isSnapshotsLoading && snapshots.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No versions yet.</p>
          ) : null}
        </section>
      ) : null}

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
        <div className="flex flex-wrap gap-2 border-b border-border bg-slate-50 p-3">
          <button
            className={`rounded-md border px-3 py-1.5 text-sm font-medium transition ${
              editor?.isActive("heading", { level: 1 })
                ? "border-accent bg-emerald-50 text-accent-strong"
                : "border-border bg-panel text-ink hover:bg-slate-100"
            }`}
            type="button"
            disabled={!canEdit}
            onClick={() =>
              editor?.chain().focus().toggleHeading({ level: 1 }).run()
            }
          >
            H1
          </button>
          <button
            className={`rounded-md border px-3 py-1.5 text-sm font-medium transition ${
              editor?.isActive("heading", { level: 2 })
                ? "border-accent bg-emerald-50 text-accent-strong"
                : "border-border bg-panel text-ink hover:bg-slate-100"
            }`}
            type="button"
            disabled={!canEdit}
            onClick={() =>
              editor?.chain().focus().toggleHeading({ level: 2 }).run()
            }
          >
            H2
          </button>
          <button
            className={`rounded-md border px-3 py-1.5 text-sm font-medium transition ${
              editor?.isActive("bold")
                ? "border-accent bg-emerald-50 text-accent-strong"
                : "border-border bg-panel text-ink hover:bg-slate-100"
            }`}
            type="button"
            disabled={!canEdit}
            onClick={() => editor?.chain().focus().toggleBold().run()}
          >
            Bold
          </button>
          <button
            className={`rounded-md border px-3 py-1.5 text-sm font-medium transition ${
              editor?.isActive("italic")
                ? "border-accent bg-emerald-50 text-accent-strong"
                : "border-border bg-panel text-ink hover:bg-slate-100"
            }`}
            type="button"
            disabled={!canEdit}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          >
            Italic
          </button>
          <button
            className={`rounded-md border px-3 py-1.5 text-sm font-medium transition ${
              editor?.isActive("bulletList")
                ? "border-accent bg-emerald-50 text-accent-strong"
                : "border-border bg-panel text-ink hover:bg-slate-100"
            }`}
            type="button"
            disabled={!canEdit}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          >
            Bullet list
          </button>
          <button
            className={`rounded-md border px-3 py-1.5 text-sm font-medium transition ${
              editor?.isActive("orderedList")
                ? "border-accent bg-emerald-50 text-accent-strong"
                : "border-border bg-panel text-ink hover:bg-slate-100"
            }`}
            type="button"
            disabled={!canEdit}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          >
            Numbered list
          </button>
          <button
            className="rounded-md border border-border bg-panel px-3 py-1.5 text-sm font-medium text-ink transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            type="button"
            disabled={!canEdit}
            onClick={() => editor?.chain().focus().undo().run()}
          >
            Undo
          </button>
          <button
            className="rounded-md border border-border bg-panel px-3 py-1.5 text-sm font-medium text-ink transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            type="button"
            disabled={!canEdit}
            onClick={() => editor?.chain().focus().redo().run()}
          >
            Redo
          </button>
        </div>

        {editor ? (
          <EditorContent editor={editor} />
        ) : (
          <div className="min-h-[66vh] p-4 text-sm text-muted">
            Loading editor...
          </div>
        )}
      </section>
    </main>
  );
}
