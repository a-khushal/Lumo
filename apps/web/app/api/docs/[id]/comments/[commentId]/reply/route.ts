import { NextResponse } from "next/server";
import { db } from "@repo/db";
import { getCurrentUser } from "../../../../../../../lib/current-user";

type RouteContext = {
  params: Promise<{ id: string; commentId: string }>;
};

type CreateReplyInput = {
  content?: unknown;
};

const readJsonBody = async <T>(request: Request): Promise<T | null> => {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
};

const normalizeCommentContent = (value: unknown) => {
  if (typeof value !== "string") {
    return null;
  }

  const content = value.trim();

  if (!content) {
    return null;
  }

  return content.slice(0, 2000);
};

const canViewWhere = (documentId: string, userId: string) => ({
  id: documentId,
  isArchived: false,
  OR: [{ ownerId: userId }, { members: { some: { userId } } }],
});

export async function POST(
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

  const body = await readJsonBody<CreateReplyInput>(request);
  const content = normalizeCommentContent(body?.content);

  if (!content) {
    return NextResponse.json(
      { error: "Reply content is required" },
      { status: 400 },
    );
  }

  const threadTarget = await db.documentComment.findFirst({
    where: {
      id: commentId,
      documentId: id,
    },
    select: {
      id: true,
      parentId: true,
    },
  });

  if (!threadTarget) {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }

  const threadId = threadTarget.parentId ?? threadTarget.id;

  const [, reply] = await db.$transaction([
    db.documentComment.update({
      where: {
        id: threadId,
      },
      data: {
        isResolved: false,
        resolvedAt: null,
        resolvedById: null,
      },
      select: {
        id: true,
      },
    }),
    db.documentComment.create({
      data: {
        documentId: id,
        authorId: user.id,
        parentId: threadId,
        content,
      },
      select: {
        id: true,
        parentId: true,
        content: true,
        createdAt: true,
        updatedAt: true,
        author: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    }),
  ]);

  return NextResponse.json({ reply }, { status: 201 });
}
