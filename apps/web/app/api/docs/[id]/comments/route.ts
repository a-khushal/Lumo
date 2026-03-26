import { NextResponse } from "next/server";
import { db } from "@repo/db";
import { z } from "zod";
import { broadcastCommentEvent } from "../../../../../lib/collab-broadcast";
import {
  canCommentOnDocument,
  getDocumentAccess,
} from "../../../../../lib/document-access";
import { getCurrentUser } from "../../../../../lib/current-user";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const createCommentSchema = z
  .object({
    content: z.string().trim().min(1).max(2000),
    quotedText: z.string().trim().max(300).optional(),
    selectionFrom: z.number().int().nonnegative().optional(),
    selectionTo: z.number().int().nonnegative().optional(),
  })
  .refine(
    (value) =>
      (value.selectionFrom === undefined && value.selectionTo === undefined) ||
      (value.selectionFrom !== undefined && value.selectionTo !== undefined),
    {
      message: "selectionFrom and selectionTo must both be provided",
    },
  );

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

  const access = await getDocumentAccess({ documentId: id, userId: user.id });

  if (!access) {
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

  const readState = await db.documentCommentRead.findUnique({
    where: {
      documentId_userId: {
        documentId: id,
        userId: user.id,
      },
    },
    select: {
      lastReadAt: true,
    },
  });

  const unreadCount = await db.documentComment.count({
    where: {
      documentId: id,
      authorId: {
        not: user.id,
      },
      createdAt: {
        gt: readState?.lastReadAt ?? new Date(0),
      },
    },
  });

  return NextResponse.json({
    comments,
    unreadCount,
    lastReadAt: readState?.lastReadAt ?? null,
  });
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

  const access = await getDocumentAccess({ documentId: id, userId: user.id });

  if (!access) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  if (!canCommentOnDocument(access.role)) {
    return NextResponse.json({ error: "No comment access" }, { status: 403 });
  }

  const body = await readJsonBody<unknown>(request);
  const parsedBody = createCommentSchema.safeParse(body ?? {});

  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsedBody.error.flatten() },
      { status: 400 },
    );
  }

  const content = normalizeCommentContent(parsedBody.data.content);

  if (!content) {
    return NextResponse.json(
      { error: "Comment content is required" },
      { status: 400 },
    );
  }

  const selectionFrom = normalizeSelectionPosition(
    parsedBody.data.selectionFrom,
  );
  const selectionTo = normalizeSelectionPosition(parsedBody.data.selectionTo);

  const comment = await db.documentComment.create({
    data: {
      documentId: id,
      authorId: user.id,
      content,
      quotedText: normalizeQuotedText(parsedBody.data.quotedText),
      selectionFrom,
      selectionTo,
    },
    select: commentSelect,
  });

  await broadcastCommentEvent(id, {
    action: "created",
    threadId: comment.id,
  });

  return NextResponse.json({ comment }, { status: 201 });
}
