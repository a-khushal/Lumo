import { SignJWT } from "jose";

type CommentEventAction = "created" | "replied" | "resolved";

type CommentEventPayload = {
  action: CommentEventAction;
  threadId: string;
};

const getCollabSecret = () => {
  const value = process.env.COLLAB_TOKEN_SECRET ?? process.env.NEXTAUTH_SECRET;

  if (!value) {
    return null;
  }

  return new TextEncoder().encode(value);
};

const resolveCollabHttpUrl = () => {
  if (process.env.COLLAB_HTTP_URL) {
    return process.env.COLLAB_HTTP_URL;
  }

  const wsUrl = process.env.NEXT_PUBLIC_COLLAB_URL;

  if (!wsUrl) {
    return "http://127.0.0.1:1234";
  }

  if (wsUrl.startsWith("wss://")) {
    return wsUrl.replace("wss://", "https://");
  }

  if (wsUrl.startsWith("ws://")) {
    return wsUrl.replace("ws://", "http://");
  }

  return wsUrl;
};

const createInternalToken = async (documentId: string) => {
  const secret = getCollabSecret();

  if (!secret) {
    return null;
  }

  return new SignJWT({ doc: documentId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("web-api")
    .setIssuer("docs-web")
    .setAudience("docs-collab-internal")
    .setIssuedAt()
    .setExpirationTime("60s")
    .sign(secret);
};

export const broadcastCommentEvent = async (
  documentId: string,
  event: CommentEventPayload,
) => {
  const token = await createInternalToken(documentId);

  if (!token) {
    return;
  }

  const collabUrl = resolveCollabHttpUrl();

  try {
    await fetch(`${collabUrl}/internal/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        documentId,
        event: {
          channel: "comments",
          ...event,
          at: new Date().toISOString(),
        },
      }),
      cache: "no-store",
    });
  } catch {
    // Ignore transient broadcast failures. REST response still succeeds.
  }
};
