"use client";

import Link from "next/link";
import { HocuspocusProvider } from "@hocuspocus/provider";
import Collaboration from "@tiptap/extension-collaboration";
import StarterKit from "@tiptap/starter-kit";
import { EditorContent, useEditor } from "@tiptap/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import {
  CommentAnchorExtension,
  syncCommentAnchors,
  type CommentAnchor,
} from "./comment-anchor-extension";

type DocumentEditorProps = {
  documentId: string;
  currentUserId: string;
  currentUserEmail: string;
  currentUserName: string | null;
  collabToken: string;
  currentUserRole: DocumentRole;
  initialTitle: string;
  initialContent: unknown;
  updatedAt: string;
};

type SaveState = "saved" | "saving" | "error";
type InviteRole = "EDITOR" | "COMMENTER" | "VIEWER";
type DocumentRole = "OWNER" | InviteRole;
type Collaborator = {
  id: string;
  name: string;
  color: string;
};

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

type CommentReplyResponse = {
  id: string;
  parentId: string | null;
  content: string;
  createdAt: string;
  updatedAt: string;
  author: MemberUser;
};

type CommentThreadResponse = {
  id: string;
  parentId: string | null;
  content: string;
  quotedText: string | null;
  selectionFrom: number | null;
  selectionTo: number | null;
  isResolved: boolean;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  author: MemberUser;
  resolvedBy: MemberUser | null;
  replies: CommentReplyResponse[];
};

type CommentsResponse = {
  comments: CommentThreadResponse[];
  unreadCount: number;
  lastReadAt: string | null;
};

type CommentMutationResponse = {
  comment: CommentThreadResponse;
};

type ApiError = {
  error?: string;
};

type InviteStatus = "idle" | "submitting" | "error" | "success";
type EditorDoc = Record<string, unknown>;
type CollabStatus = "connecting" | "connected" | "disconnected";
type CollabEvent = {
  channel?: unknown;
  action?: unknown;
  threadId?: unknown;
  suggestionId?: unknown;
};

type SuggestionStatus = "OPEN" | "ACCEPTED" | "REJECTED";

type SuggestionResponse = {
  id: string;
  status: SuggestionStatus;
  proposedTitle: string | null;
  proposedContent: unknown;
  createdAt: string;
  reviewedAt: string | null;
  suggestedBy: MemberUser;
  reviewedBy: MemberUser | null;
};

type SuggestionsResponse = {
  suggestions: SuggestionResponse[];
};

type DocumentResponse = {
  document: {
    title: string;
    content: unknown;
    updatedAt: string;
  };
};

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

const collabUrl =
  process.env.NEXT_PUBLIC_COLLAB_URL?.trim() || "ws://127.0.0.1:1234";

const getUserColor = (id: string) => {
  const palette = [
    "#136f63",
    "#0ea5e9",
    "#f59e0b",
    "#ef4444",
    "#8b5cf6",
    "#059669",
    "#db2777",
  ];

  let hash = 0;

  for (let index = 0; index < id.length; index += 1) {
    hash = (hash << 5) - hash + id.charCodeAt(index);
    hash |= 0;
  }

  return palette[Math.abs(hash) % palette.length] || "#136f63";
};

const getSelectionPayload = (
  editorInstance:
    | {
        state: {
          selection: {
            from: number;
            to: number;
            empty: boolean;
          };
          doc: {
            textBetween: (
              from: number,
              to: number,
              blockSeparator?: string,
            ) => string;
          };
        };
      }
    | null
    | undefined,
) => {
  if (!editorInstance) {
    return null;
  }

  const { from, to, empty } = editorInstance.state.selection;

  if (empty) {
    return null;
  }

  const text = editorInstance.state.doc.textBetween(from, to, " ").trim();

  if (!text) {
    return null;
  }

  return {
    quotedText: text.slice(0, 300),
    selectionFrom: from,
    selectionTo: to,
  };
};

export function DocumentEditor({
  documentId,
  currentUserId,
  currentUserEmail,
  currentUserName,
  collabToken,
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
  const [isCommentsOpen, setIsCommentsOpen] = useState(false);
  const [isSuggestionsOpen, setIsSuggestionsOpen] = useState(false);
  const [hasUnreadCommentActivity, setHasUnreadCommentActivity] =
    useState(false);
  const [isMembersLoading, setIsMembersLoading] = useState(false);
  const [isSnapshotsLoading, setIsSnapshotsLoading] = useState(false);
  const [isCommentsLoading, setIsCommentsLoading] = useState(false);
  const [isSuggestionsLoading, setIsSuggestionsLoading] = useState(false);
  const [isCreatingSnapshot, setIsCreatingSnapshot] = useState(false);
  const [isCreatingComment, setIsCreatingComment] = useState(false);
  const [isSubmittingSuggestion, setIsSubmittingSuggestion] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [snapshotsError, setSnapshotsError] = useState<string | null>(null);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [owner, setOwner] = useState<OwnerResponse | null>(null);
  const [members, setMembers] = useState<MemberResponse[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotResponse[]>([]);
  const [commentThreads, setCommentThreads] = useState<CommentThreadResponse[]>(
    [],
  );
  const [unreadCommentCount, setUnreadCommentCount] = useState(0);
  const [commentsRefreshNonce, setCommentsRefreshNonce] = useState(0);
  const [suggestionsRefreshNonce, setSuggestionsRefreshNonce] = useState(0);
  const [activeCommentThreadId, setActiveCommentThreadId] = useState<
    string | null
  >(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [selectedText, setSelectedText] = useState("");
  const [editorMode, setEditorMode] = useState<"edit" | "suggest">("edit");
  const [suggestions, setSuggestions] = useState<SuggestionResponse[]>([]);
  const [suggestionTitle, setSuggestionTitle] = useState(initialTitle);
  const [suggestionText, setSuggestionText] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<InviteRole>("EDITOR");
  const [inviteStatus, setInviteStatus] = useState<InviteStatus>("idle");
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);
  const [memberAction, setMemberAction] = useState<{
    memberId: string;
    type: "updating-role" | "removing";
  } | null>(null);
  const [snapshotActionId, setSnapshotActionId] = useState<string | null>(null);
  const [commentActionId, setCommentActionId] = useState<string | null>(null);
  const [suggestionActionId, setSuggestionActionId] = useState<string | null>(
    null,
  );
  const [collabStatus, setCollabStatus] = useState<CollabStatus>("connecting");
  const [collaborators, setCollaborators] = useState<Collaborator[]>([
    {
      id: currentUserId,
      name: currentUserName || currentUserEmail,
      color: getUserColor(currentUserId),
    },
  ]);
  const lastPayloadRef = useRef(
    JSON.stringify({ title: initialTitle, content: startingContent }),
  );

  const canManageMembers = owner?.user.id === currentUserId;
  const canEdit = currentUserRole === "OWNER" || currentUserRole === "EDITOR";
  const canComment =
    currentUserRole === "OWNER" ||
    currentUserRole === "EDITOR" ||
    currentUserRole === "COMMENTER";
  const canTypeInEditor = canEdit && editorMode === "edit";
  const canSubmitSuggestion = canComment && editorMode === "suggest";

  const commentAnchors = useMemo<CommentAnchor[]>(() => {
    return commentThreads
      .filter(
        (thread) =>
          thread.selectionFrom !== null &&
          thread.selectionTo !== null &&
          thread.selectionTo > thread.selectionFrom,
      )
      .map((thread) => ({
        id: thread.id,
        from: thread.selectionFrom as number,
        to: thread.selectionTo as number,
        isResolved: thread.isResolved,
      }));
  }, [commentThreads]);

  useEffect(() => {
    if (!canEdit) {
      setEditorMode("suggest");
    }
  }, [canEdit]);

  useEffect(() => {
    setSuggestionTitle(title);
  }, [title]);

  const collaborationState = useMemo(() => {
    const document = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: collabUrl,
      name: documentId,
      document,
      token: collabToken,
    });

    return { document, provider };
  }, [collabToken, documentId]);

  useEffect(() => {
    if (collaborationState.provider.awareness) {
      collaborationState.provider.setAwarenessField("user", {
        id: currentUserId,
        name: currentUserName || currentUserEmail,
        color: getUserColor(currentUserId),
      });
    }

    const handleStatus = ({
      status,
    }: {
      status: "connected" | "connecting" | "disconnected";
    }) => {
      setCollabStatus(status);
    };

    const handleAwarenessChange = () => {
      if (!collaborationState.provider.awareness) {
        setCollaborators([
          {
            id: currentUserId,
            name: currentUserName || currentUserEmail,
            color: getUserColor(currentUserId),
          },
        ]);
        return;
      }

      const states = collaborationState.provider.awareness.getStates();
      const nextCollaborators = new Map<string, Collaborator>();

      states.forEach((stateValue) => {
        if (!stateValue || typeof stateValue !== "object") {
          return;
        }

        const userValue = (stateValue as { user?: unknown }).user;

        if (!userValue || typeof userValue !== "object") {
          return;
        }

        const id = (userValue as { id?: unknown }).id;

        if (typeof id !== "string" || !id) {
          return;
        }

        const nameValue = (userValue as { name?: unknown }).name;
        const colorValue = (userValue as { color?: unknown }).color;

        nextCollaborators.set(id, {
          id,
          name:
            typeof nameValue === "string" && nameValue.trim()
              ? nameValue
              : "Guest",
          color:
            typeof colorValue === "string" && colorValue
              ? colorValue
              : getUserColor(id),
        });
      });

      if (!nextCollaborators.has(currentUserId)) {
        nextCollaborators.set(currentUserId, {
          id: currentUserId,
          name: currentUserName || currentUserEmail,
          color: getUserColor(currentUserId),
        });
      }

      setCollaborators(Array.from(nextCollaborators.values()));
    };

    const handleStateless = (event: { payload?: unknown }) => {
      if (typeof event?.payload !== "string") {
        return;
      }

      let payload: CollabEvent | null = null;

      try {
        payload = JSON.parse(event.payload) as CollabEvent;
      } catch {
        return;
      }

      if (!payload) {
        return;
      }

      if (payload.channel === "comments") {
        if (isCommentsOpen) {
          setCommentsRefreshNonce((prev) => prev + 1);
        } else {
          setHasUnreadCommentActivity(true);
          setUnreadCommentCount((prev) => prev + 1);
        }

        return;
      }

      if (payload.channel === "suggestions") {
        if (isSuggestionsOpen) {
          setSuggestionsRefreshNonce((prev) => prev + 1);
        }
      }
    };

    collaborationState.provider.on("status", handleStatus);
    collaborationState.provider.awareness?.on("change", handleAwarenessChange);
    collaborationState.provider.on("stateless", handleStateless);
    handleAwarenessChange();

    return () => {
      collaborationState.provider.awareness?.off(
        "change",
        handleAwarenessChange,
      );
      collaborationState.provider.off("stateless", handleStateless);
      collaborationState.provider.off("status", handleStatus);
      collaborationState.provider.destroy();
      collaborationState.document.destroy();
    };
  }, [
    collaborationState,
    currentUserEmail,
    currentUserId,
    currentUserName,
    isCommentsOpen,
    isSuggestionsOpen,
  ]);

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: {
            levels: [1, 2],
          },
        }),
        Collaboration.configure({
          document: collaborationState.document,
        }),
        CommentAnchorExtension,
      ],
      editable: canTypeInEditor,
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
      onSelectionUpdate({
        editor: currentEditor,
      }: {
        editor: {
          state: {
            selection: {
              from: number;
              to: number;
              empty: boolean;
            };
            doc: {
              textBetween: (
                from: number,
                to: number,
                blockSeparator?: string,
              ) => string;
            };
          };
        };
      }) {
        const selection = getSelectionPayload(currentEditor);
        setSelectedText(selection?.quotedText ?? "");
      },
    },
    [collaborationState],
  );

  useEffect(() => {
    editor?.setEditable(canTypeInEditor);
  }, [canTypeInEditor, editor]);

  useEffect(() => {
    syncCommentAnchors(editor, {
      anchors: commentAnchors,
      activeThreadId: activeCommentThreadId,
    });
  }, [activeCommentThreadId, commentAnchors, editor]);

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

  const loadComments = useCallback(async () => {
    setIsCommentsLoading(true);
    setCommentsError(null);

    try {
      const response = await fetch(`/api/docs/${documentId}/comments`);

      if (!response.ok) {
        throw new Error(await parseApiError(response));
      }

      const data = (await response.json()) as CommentsResponse;
      setCommentThreads(data.comments);
      setUnreadCommentCount(data.unreadCount);
    } catch (error) {
      setCommentsError(
        error instanceof Error ? error.message : "Failed to load comments",
      );
    } finally {
      setIsCommentsLoading(false);
    }
  }, [documentId]);

  const loadSuggestions = useCallback(async () => {
    setIsSuggestionsLoading(true);
    setSuggestionsError(null);

    try {
      const response = await fetch(`/api/docs/${documentId}/suggestions`);

      if (!response.ok) {
        throw new Error(await parseApiError(response));
      }

      const data = (await response.json()) as SuggestionsResponse;
      setSuggestions(data.suggestions);
    } catch (error) {
      setSuggestionsError(
        error instanceof Error ? error.message : "Failed to load suggestions",
      );
    } finally {
      setIsSuggestionsLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    if (!isSuggestionsOpen || suggestionsRefreshNonce === 0) {
      return;
    }

    void loadSuggestions();
  }, [isSuggestionsOpen, loadSuggestions, suggestionsRefreshNonce]);

  const markCommentsAsRead = useCallback(async () => {
    try {
      const response = await fetch(`/api/docs/${documentId}/comments/read`, {
        method: "POST",
      });

      if (response.ok) {
        setUnreadCommentCount(0);
      }
    } catch {
      // Best effort; ignore transient failures.
    }
  }, [documentId]);

  useEffect(() => {
    if (!isCommentsOpen || commentsRefreshNonce === 0) {
      return;
    }

    void loadComments();
    void markCommentsAsRead();
  }, [commentsRefreshNonce, isCommentsOpen, loadComments, markCommentsAsRead]);

  const statusLabel = useMemo(() => {
    if (editorMode === "suggest") {
      return "Suggesting mode";
    }

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
  }, [canEdit, currentUserRole, editorMode, lastSavedAt, saveState]);

  const openSuggestionCount = useMemo(() => {
    return suggestions.filter((suggestion) => suggestion.status === "OPEN")
      .length;
  }, [suggestions]);

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
    if (!isCommentsOpen) {
      return;
    }

    void loadComments();
    void markCommentsAsRead();
    setHasUnreadCommentActivity(false);
  }, [isCommentsOpen, loadComments, markCommentsAsRead]);

  useEffect(() => {
    if (!isSuggestionsOpen) {
      return;
    }

    void loadSuggestions();
  }, [isSuggestionsOpen, loadSuggestions]);

  useEffect(() => {
    if (isCommentsOpen) {
      return;
    }

    setActiveCommentThreadId(null);
  }, [isCommentsOpen]);

  useEffect(() => {
    if (!activeCommentThreadId) {
      return;
    }

    const stillExists = commentThreads.some(
      (thread) => thread.id === activeCommentThreadId,
    );

    if (!stillExists) {
      setActiveCommentThreadId(null);
    }
  }, [activeCommentThreadId, commentThreads]);

  useEffect(() => {
    if (!canTypeInEditor) {
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
  }, [canTypeInEditor, content, documentId, title]);

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
      editor?.commands.setContent(nextContent);
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

  const handleCreateComment = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();

    if (!canComment) {
      return;
    }

    const contentValue = commentDraft.trim();

    if (!contentValue) {
      setCommentsError("Comment content is required");
      return;
    }

    const selection = getSelectionPayload(editor);

    setIsCreatingComment(true);
    setCommentsError(null);

    try {
      const response = await fetch(`/api/docs/${documentId}/comments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: contentValue,
          quotedText: selection?.quotedText,
          selectionFrom: selection?.selectionFrom,
          selectionTo: selection?.selectionTo,
        }),
      });

      if (!response.ok) {
        throw new Error(await parseApiError(response));
      }

      const data = (await response.json()) as CommentMutationResponse;

      setCommentThreads((prev) => [...prev, data.comment]);
      setCommentDraft("");
      setSelectedText("");
    } catch (error) {
      setCommentsError(
        error instanceof Error ? error.message : "Failed to create comment",
      );
    } finally {
      setIsCreatingComment(false);
    }
  };

  const handleReplyChange = (threadId: string, value: string) => {
    setReplyDrafts((prev) => ({
      ...prev,
      [threadId]: value,
    }));
  };

  const handleReplySubmit = async (threadId: string) => {
    if (!canComment) {
      return;
    }

    const contentValue = (replyDrafts[threadId] ?? "").trim();

    if (!contentValue) {
      setCommentsError("Reply content is required");
      return;
    }

    setCommentActionId(threadId);
    setCommentsError(null);

    try {
      const response = await fetch(
        `/api/docs/${documentId}/comments/${threadId}/reply`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ content: contentValue }),
        },
      );

      if (!response.ok) {
        throw new Error(await parseApiError(response));
      }

      await loadComments();
      setReplyDrafts((prev) => ({
        ...prev,
        [threadId]: "",
      }));
    } catch (error) {
      setCommentsError(
        error instanceof Error ? error.message : "Failed to add reply",
      );
    } finally {
      setCommentActionId(null);
    }
  };

  const handleResolveToggle = async (threadId: string, resolved: boolean) => {
    if (!canComment) {
      return;
    }

    setCommentActionId(threadId);
    setCommentsError(null);

    try {
      const response = await fetch(
        `/api/docs/${documentId}/comments/${threadId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ resolved }),
        },
      );

      if (!response.ok) {
        throw new Error(await parseApiError(response));
      }

      await loadComments();
    } catch (error) {
      setCommentsError(
        error instanceof Error ? error.message : "Failed to update thread",
      );
    } finally {
      setCommentActionId(null);
    }
  };

  const syncDocumentFromServer = async () => {
    const response = await fetch(`/api/docs/${documentId}`);

    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }

    const data = (await response.json()) as DocumentResponse;
    const nextContent = normalizeEditorContent(data.document.content);
    const nextTitle = data.document.title;
    const nextPayload = JSON.stringify({
      title: nextTitle.trim() || "Untitled document",
      content: nextContent,
    });

    lastPayloadRef.current = nextPayload;
    setTitle(nextTitle);
    setContent(nextContent);
    editor?.commands.setContent(nextContent);
    setSaveState("saved");
    setLastSavedAt(data.document.updatedAt);
  };

  const handleSubmitSuggestion = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();

    if (!canSubmitSuggestion) {
      return;
    }

    const normalizedTitle = suggestionTitle.trim();
    const normalizedText = suggestionText.trim();

    if (!normalizedTitle && !normalizedText) {
      setSuggestionsError("Add a title or text change for the suggestion.");
      return;
    }

    setIsSubmittingSuggestion(true);
    setSuggestionsError(null);

    try {
      const response = await fetch(`/api/docs/${documentId}/suggestions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          proposedTitle: normalizedTitle || null,
          proposedText: normalizedText,
        }),
      });

      if (!response.ok) {
        throw new Error(await parseApiError(response));
      }

      setSuggestionText("");
      setEditorMode(canEdit ? "edit" : "suggest");
      await loadSuggestions();
    } catch (error) {
      setSuggestionsError(
        error instanceof Error ? error.message : "Failed to create suggestion",
      );
    } finally {
      setIsSubmittingSuggestion(false);
    }
  };

  const handleReviewSuggestion = async (
    suggestionId: string,
    action: "accept" | "reject",
  ) => {
    if (!canEdit) {
      return;
    }

    setSuggestionActionId(suggestionId);
    setSuggestionsError(null);

    try {
      const response = await fetch(
        `/api/docs/${documentId}/suggestions/${suggestionId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action }),
        },
      );

      if (!response.ok) {
        throw new Error(await parseApiError(response));
      }

      await loadSuggestions();

      if (action === "accept") {
        await syncDocumentFromServer();
      }
    } catch (error) {
      setSuggestionsError(
        error instanceof Error ? error.message : "Failed to review suggestion",
      );
    } finally {
      setSuggestionActionId(null);
    }
  };

  const jumpToCommentAnchor = (thread: CommentThreadResponse) => {
    if (
      !editor ||
      thread.selectionFrom === null ||
      thread.selectionTo === null
    ) {
      return;
    }

    const maxPosition = Math.max(editor.state.doc.content.size, 1);
    const from = Math.min(Math.max(thread.selectionFrom, 1), maxPosition);
    const to = Math.min(Math.max(thread.selectionTo, 1), maxPosition);

    if (to <= from) {
      return;
    }

    setActiveCommentThreadId(thread.id);

    editor.chain().focus().setTextSelection({ from, to }).run();
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
            disabled={!canTypeInEditor}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Untitled document"
          />
        </div>
        <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-end">
          <div className="flex items-center gap-2">
            {canComment ? (
              <div className="flex overflow-hidden rounded-full border border-border">
                <button
                  className={`px-3 py-1.5 text-xs font-semibold transition ${
                    editorMode === "edit"
                      ? "bg-accent text-white"
                      : "bg-panel text-ink hover:bg-slate-50"
                  }`}
                  type="button"
                  onClick={() => setEditorMode("edit")}
                  disabled={!canEdit}
                >
                  Edit
                </button>
                <button
                  className={`px-3 py-1.5 text-xs font-semibold transition ${
                    editorMode === "suggest"
                      ? "bg-accent text-white"
                      : "bg-panel text-ink hover:bg-slate-50"
                  }`}
                  type="button"
                  onClick={() => setEditorMode("suggest")}
                  disabled={!canComment}
                >
                  Suggest
                </button>
              </div>
            ) : null}
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
              onClick={() => setIsSuggestionsOpen((value) => !value)}
            >
              {isSuggestionsOpen ? "Close suggestions" : "Suggestions"}
              {openSuggestionCount > 0 ? (
                <span className="ml-2 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                  {openSuggestionCount}
                </span>
              ) : null}
            </button>
            <button
              className="rounded-full border border-border bg-panel px-4 py-2 text-sm font-medium text-ink transition hover:bg-slate-50"
              type="button"
              onClick={() => setIsCommentsOpen((value) => !value)}
            >
              {isCommentsOpen ? "Close comments" : "Comments"}
              {!isCommentsOpen && hasUnreadCommentActivity ? (
                <span className="ml-2 inline-block h-2 w-2 rounded-full bg-amber-500" />
              ) : null}
              {!isCommentsOpen && unreadCommentCount > 0 ? (
                <span className="ml-2 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                  {unreadCommentCount}
                </span>
              ) : null}
            </button>
            <button
              className="rounded-full border border-border bg-panel px-4 py-2 text-sm font-medium text-ink transition hover:bg-slate-50"
              type="button"
              onClick={() => setIsShareOpen((value) => !value)}
            >
              {isShareOpen ? "Close" : "Share"}
            </button>
          </div>
          <div className="flex flex-col items-end gap-1">
            <p className="text-sm text-muted">
              {statusLabel} · {collabStatus} · {collaborators.length} online
            </p>
            <div className="flex items-center gap-1.5">
              {collaborators.slice(0, 4).map((collaborator) => (
                <span
                  key={collaborator.id}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold text-white"
                  style={{ backgroundColor: collaborator.color }}
                  title={collaborator.name}
                >
                  {collaborator.name.slice(0, 1).toUpperCase()}
                </span>
              ))}
              {collaborators.length > 4 ? (
                <span className="rounded-full border border-border bg-panel px-2 py-0.5 text-xs font-medium text-muted">
                  +{collaborators.length - 4}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      {!canTypeInEditor ? (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700">
          {editorMode === "suggest"
            ? "Suggesting mode is active. Direct editing is disabled."
            : `You have ${currentUserRole} access. Editing is disabled.`}
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

      {isSuggestionsOpen ? (
        <section className="mt-4 rounded-2xl border border-border bg-panel p-4 shadow-card">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-ink">Suggestions</h2>
              <p className="text-sm text-muted">
                Propose document updates and review them.
              </p>
            </div>
            <span className="rounded-full border border-border bg-slate-50 px-2 py-1 text-xs font-semibold text-muted">
              {openSuggestionCount} open
            </span>
          </div>

          {canSubmitSuggestion ? (
            <form className="mb-4 grid gap-2" onSubmit={handleSubmitSuggestion}>
              <input
                className="rounded-lg border border-border bg-panel px-3 py-2 text-sm text-ink outline-none ring-accent/40 focus:ring-2"
                value={suggestionTitle}
                onChange={(event) => setSuggestionTitle(event.target.value)}
                placeholder="Proposed title"
              />
              <textarea
                className="min-h-20 rounded-lg border border-border bg-panel px-3 py-2 text-sm text-ink outline-none ring-accent/40 focus:ring-2"
                value={suggestionText}
                onChange={(event) => setSuggestionText(event.target.value)}
                placeholder="Describe the suggested text update"
              />
              <div className="flex justify-end">
                <button
                  className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
                  type="submit"
                  disabled={isSubmittingSuggestion}
                >
                  {isSubmittingSuggestion
                    ? "Submitting..."
                    : "Submit suggestion"}
                </button>
              </div>
            </form>
          ) : null}

          {isSuggestionsLoading ? (
            <p className="text-sm text-muted">Loading suggestions...</p>
          ) : null}

          {suggestionsError ? (
            <p className="mb-3 text-sm font-medium text-rose-700">
              {suggestionsError}
            </p>
          ) : null}

          <ul className="grid gap-2">
            {suggestions.map((suggestion) => {
              const isBusy = suggestionActionId === suggestion.id;

              return (
                <li
                  className="rounded-xl border border-border bg-slate-50 p-3"
                  key={suggestion.id}
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-ink">
                      {formatName(suggestion.suggestedBy)}
                    </p>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                        suggestion.status === "OPEN"
                          ? "border-amber-200 bg-amber-50 text-amber-700"
                          : suggestion.status === "ACCEPTED"
                            ? "border-emerald-200 bg-emerald-50 text-accent-strong"
                            : "border-rose-200 bg-rose-50 text-rose-700"
                      }`}
                    >
                      {suggestion.status}
                    </span>
                  </div>

                  {suggestion.proposedTitle ? (
                    <p className="text-sm text-ink">
                      <span className="font-semibold">Title:</span>{" "}
                      {suggestion.proposedTitle}
                    </p>
                  ) : null}

                  <p className="text-xs text-muted">
                    Created {formatUpdatedAt(suggestion.createdAt)}
                    {suggestion.reviewedBy
                      ? ` · Reviewed by ${formatName(suggestion.reviewedBy)}`
                      : ""}
                  </p>

                  {canEdit && suggestion.status === "OPEN" ? (
                    <div className="mt-3 flex items-center justify-end gap-2">
                      <button
                        className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-sm font-medium text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                        type="button"
                        disabled={isBusy}
                        onClick={() => {
                          void handleReviewSuggestion(suggestion.id, "reject");
                        }}
                      >
                        Reject
                      </button>
                      <button
                        className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-accent-strong transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                        type="button"
                        disabled={isBusy}
                        onClick={() => {
                          void handleReviewSuggestion(suggestion.id, "accept");
                        }}
                      >
                        Accept
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>

          {!isSuggestionsLoading && suggestions.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No suggestions yet.</p>
          ) : null}
        </section>
      ) : null}

      {isCommentsOpen ? (
        <section className="mt-4 rounded-2xl border border-border bg-panel p-4 shadow-card">
          <div className="mb-3">
            <h2 className="text-base font-semibold text-ink">Comments</h2>
            <p className="text-sm text-muted">
              Start a thread on selected text and discuss changes.
            </p>
          </div>

          {canComment ? (
            <form className="mb-4 grid gap-2" onSubmit={handleCreateComment}>
              <textarea
                className="min-h-20 rounded-lg border border-border bg-panel px-3 py-2 text-sm text-ink outline-none ring-accent/40 focus:ring-2"
                value={commentDraft}
                onChange={(event) => setCommentDraft(event.target.value)}
                placeholder="Add a comment"
              />

              {selectedText ? (
                <p className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-accent-strong">
                  Selected: &quot;{selectedText}&quot;
                </p>
              ) : (
                <p className="text-sm text-muted">
                  Tip: highlight text in the editor to attach this comment to a
                  selection.
                </p>
              )}

              <div className="flex justify-end">
                <button
                  className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
                  type="submit"
                  disabled={isCreatingComment}
                >
                  {isCreatingComment ? "Posting..." : "Post comment"}
                </button>
              </div>
            </form>
          ) : (
            <p className="mb-4 text-sm text-muted">
              You can read comments but cannot post with your current role.
            </p>
          )}

          {isCommentsLoading ? (
            <p className="text-sm text-muted">Loading comments...</p>
          ) : null}

          {commentsError ? (
            <p className="mb-3 text-sm font-medium text-rose-700">
              {commentsError}
            </p>
          ) : null}

          <ul className="grid gap-3">
            {commentThreads.map((thread) => {
              const isBusy = commentActionId === thread.id;
              const isActiveThread = activeCommentThreadId === thread.id;

              return (
                <li
                  className={`rounded-xl border p-3 ${
                    isActiveThread
                      ? "border-amber-300 bg-amber-50"
                      : "border-border bg-slate-50"
                  }`}
                  key={thread.id}
                  onMouseEnter={() => setActiveCommentThreadId(thread.id)}
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-ink">
                      {formatName(thread.author)}
                    </p>
                    <div className="flex items-center gap-2">
                      {thread.selectionFrom !== null &&
                      thread.selectionTo !== null ? (
                        <button
                          className="rounded-md border border-border bg-panel px-2 py-1 text-xs font-medium text-ink transition hover:bg-slate-100"
                          type="button"
                          onClick={() => jumpToCommentAnchor(thread)}
                        >
                          Jump to text
                        </button>
                      ) : null}
                      <span className="text-xs text-muted">
                        {formatUpdatedAt(thread.createdAt)}
                      </span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                          thread.isResolved
                            ? "border-emerald-200 bg-emerald-50 text-accent-strong"
                            : "border-amber-200 bg-amber-50 text-amber-700"
                        }`}
                      >
                        {thread.isResolved ? "Resolved" : "Open"}
                      </span>
                    </div>
                  </div>

                  {thread.quotedText ? (
                    <p className="mb-2 rounded-md border border-emerald-100 bg-emerald-50 px-2 py-1 text-sm text-accent-strong">
                      &quot;{thread.quotedText}&quot;
                    </p>
                  ) : null}

                  <p className="text-sm text-ink">{thread.content}</p>

                  <ul className="mt-3 grid gap-2">
                    {thread.replies.map((reply) => (
                      <li
                        className="rounded-lg border border-border bg-panel px-3 py-2"
                        key={reply.id}
                      >
                        <p className="text-xs font-semibold text-ink">
                          {formatName(reply.author)}
                        </p>
                        <p className="mt-1 text-sm text-ink">{reply.content}</p>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-3 grid gap-2">
                    {canComment ? (
                      <>
                        <textarea
                          className="min-h-16 rounded-lg border border-border bg-panel px-3 py-2 text-sm text-ink outline-none ring-accent/40 focus:ring-2"
                          value={replyDrafts[thread.id] ?? ""}
                          onChange={(event) =>
                            handleReplyChange(thread.id, event.target.value)
                          }
                          placeholder="Reply to thread"
                        />

                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <button
                            className="rounded-lg border border-border bg-panel px-3 py-1.5 text-sm font-medium text-ink transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                            type="button"
                            disabled={isBusy}
                            onClick={() => {
                              void handleReplySubmit(thread.id);
                            }}
                          >
                            {isBusy ? "Saving..." : "Reply"}
                          </button>

                          <button
                            className="rounded-lg border border-border bg-panel px-3 py-1.5 text-sm font-medium text-ink transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                            type="button"
                            disabled={isBusy}
                            onClick={() => {
                              void handleResolveToggle(
                                thread.id,
                                !thread.isResolved,
                              );
                            }}
                          >
                            {thread.isResolved ? "Reopen" : "Resolve"}
                          </button>
                        </div>
                      </>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>

          {!isCommentsLoading && commentThreads.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No comments yet.</p>
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
            disabled={!canTypeInEditor}
            onClick={() =>
              editor
                ?.chain()
                .focus()
                .toggleNode("heading", "paragraph", { level: 1 })
                .run()
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
            disabled={!canTypeInEditor}
            onClick={() =>
              editor
                ?.chain()
                .focus()
                .toggleNode("heading", "paragraph", { level: 2 })
                .run()
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
            disabled={!canTypeInEditor}
            onClick={() => editor?.chain().focus().toggleMark("bold").run()}
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
            disabled={!canTypeInEditor}
            onClick={() => editor?.chain().focus().toggleMark("italic").run()}
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
            disabled={!canTypeInEditor}
            onClick={() =>
              editor?.chain().focus().toggleList("bulletList", "listItem").run()
            }
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
            disabled={!canTypeInEditor}
            onClick={() =>
              editor
                ?.chain()
                .focus()
                .toggleList("orderedList", "listItem")
                .run()
            }
          >
            Numbered list
          </button>
          <button
            className="rounded-md border border-border bg-panel px-3 py-1.5 text-sm font-medium text-ink transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            type="button"
            disabled={!canTypeInEditor}
            onClick={() => editor?.chain().focus().undo().run()}
          >
            Undo
          </button>
          <button
            className="rounded-md border border-border bg-panel px-3 py-1.5 text-sm font-medium text-ink transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            type="button"
            disabled={!canTypeInEditor}
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
