import { NextResponse } from "next/server";
import { db } from "@repo/db";
import { broadcastCommentEvent } from "../../../../../../lib/collab-broadcast";
import { getCurrentUser } from "../../../../../../lib/current-user";

type RouteContext = {
  params: Promise<{ id: string; commentId: string }>;
};

type UpdateCommentInput = {
  resolved?: unknown;
};

const readJsonBody = async <T>(request: Request): Promise<T | null> => {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
};

const canViewWhere = (documentId: string, userId: string) => ({
  id: documentId,
  isArchived: false,
  OR: [{ ownerId: userId }, { members: { some: { userId } } }],
});

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, commentId } = await context.params;

  const document = await db.document.findFirst({
    where: canViewWhere(id, user.id),
    select: {
      id: true,
      ownerId: true,
      members: {
        where: {
          userId: user.id,
        },
        select: {
          role: true,
        },
        take: 1,
      },
    },
  });

  if (!document) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const memberRole = document.members[0]?.role;
  const canComment =
    document.ownerId === user.id ||
    memberRole === "OWNER" ||
    memberRole === "EDITOR" ||
    memberRole === "COMMENTER";

  if (!canComment) {
    return NextResponse.json({ error: "No comment access" }, { status: 403 });
  }

  const body = await readJsonBody<UpdateCommentInput>(request);

  if (typeof body?.resolved !== "boolean") {
    return NextResponse.json(
      { error: "resolved boolean is required" },
      { status: 400 },
    );
  }

  const comment = await db.documentComment.findFirst({
    where: {
      id: commentId,
      documentId: id,
    },
    select: {
      id: true,
      parentId: true,
    },
  });

  if (!comment) {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }

  const threadId = comment.parentId ?? comment.id;

  const updatedComment = await db.documentComment.update({
    where: {
      id: threadId,
    },
    data: {
      isResolved: body.resolved,
      resolvedAt: body.resolved ? new Date() : null,
      resolvedById: body.resolved ? user.id : null,
    },
    select: {
      id: true,
      isResolved: true,
      resolvedAt: true,
      resolvedBy: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
      updatedAt: true,
    },
  });

  await broadcastCommentEvent(id, {
    action: "resolved",
    threadId,
  });

  return NextResponse.json({ comment: updatedComment });
}
