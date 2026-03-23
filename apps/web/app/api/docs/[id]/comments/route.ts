import { NextResponse } from "next/server";
import { db } from "@repo/db";
import { getCurrentUser } from "../../../../../lib/current-user";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type CreateCommentInput = {
  content?: unknown;
  quotedText?: unknown;
  selectionFrom?: unknown;
  selectionTo?: unknown;
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

const normalizeQuotedText = (value: unknown) => {
  if (typeof value !== "string") {
    return null;
  }

  const quoted = value.trim();

  if (!quoted) {
    return null;
  }

  return quoted.slice(0, 300);
};

const normalizeSelectionPosition = (value: unknown) => {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return null;
  }

  if (value < 0) {
    return null;
  }

  return value;
};

const canViewWhere = (documentId: string, userId: string) => ({
  id: documentId,
  isArchived: false,
  OR: [{ ownerId: userId }, { members: { some: { userId } } }],
});

const authorSelect = {
  id: true,
  email: true,
  name: true,
} as const;

const commentSelect = {
  id: true,
  parentId: true,
  content: true,
  quotedText: true,
  selectionFrom: true,
  selectionTo: true,
  isResolved: true,
  resolvedAt: true,
  createdAt: true,
  updatedAt: true,
  author: {
    select: authorSelect,
  },
  resolvedBy: {
    select: authorSelect,
  },
  replies: {
    orderBy: {
      createdAt: "asc" as const,
    },
    select: {
      id: true,
      parentId: true,
      content: true,
      createdAt: true,
      updatedAt: true,
      author: {
        select: authorSelect,
      },
    },
  },
} as const;

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;

  const document = await db.document.findFirst({
    where: canViewWhere(id, user.id),
    select: { id: true },
  });

  if (!document) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const comments = await db.documentComment.findMany({
    where: {
      documentId: id,
      parentId: null,
    },
    orderBy: {
      createdAt: "asc",
    },
    select: commentSelect,
  });

  return NextResponse.json({ comments });
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;

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

  const body = await readJsonBody<CreateCommentInput>(request);
  const content = normalizeCommentContent(body?.content);

  if (!content) {
    return NextResponse.json(
      { error: "Comment content is required" },
      { status: 400 },
    );
  }

  const selectionFrom = normalizeSelectionPosition(body?.selectionFrom);
  const selectionTo = normalizeSelectionPosition(body?.selectionTo);

  const comment = await db.documentComment.create({
    data: {
      documentId: id,
      authorId: user.id,
      content,
      quotedText: normalizeQuotedText(body?.quotedText),
      selectionFrom,
      selectionTo,
    },
    select: commentSelect,
  });

  return NextResponse.json({ comment }, { status: 201 });
}
