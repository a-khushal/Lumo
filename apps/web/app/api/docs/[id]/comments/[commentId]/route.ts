import { NextResponse } from "next/server";
import { db } from "@repo/db";
import { broadcastCommentEvent } from "../../../../../../lib/collab-broadcast";
import {
  canCommentOnDocument,
  getDocumentAccess,
} from "../../../../../../lib/document-access";
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

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, commentId } = await context.params;

  const access = await getDocumentAccess({ documentId: id, userId: user.id });

  if (!access) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  if (!canCommentOnDocument(access.role)) {
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
