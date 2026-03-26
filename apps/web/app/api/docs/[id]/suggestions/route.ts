import { NextResponse } from "next/server";
import { db, type Prisma } from "@repo/db";
import { broadcastSuggestionEvent } from "../../../../../lib/collab-broadcast";
import {
  canCommentOnDocument,
  getDocumentAccess,
  toDocContentFromText,
} from "../../../../../lib/document-access";
import { getCurrentUser } from "../../../../../lib/current-user";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type CreateSuggestionInput = {
  proposedTitle?: unknown;
  proposedContent?: unknown;
  proposedText?: unknown;
};

const readJsonBody = async <T>(request: Request): Promise<T | null> => {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
};

const normalizeTitle = (value: unknown) => {
  if (typeof value !== "string") {
    return null;
  }

  const title = value.trim();
  return title.length > 0 ? title.slice(0, 120) : null;
};

const normalizeSuggestedContent = (
  proposedContent: unknown,
  proposedText: unknown,
): Prisma.InputJsonValue => {
  if (proposedContent && typeof proposedContent === "object") {
    return proposedContent as Prisma.InputJsonValue;
  }

  if (typeof proposedText === "string") {
    return toDocContentFromText(proposedText);
  }

  return toDocContentFromText("");
};

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

  const suggestions = await db.documentSuggestion.findMany({
    where: {
      documentId: id,
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
      status: true,
      proposedTitle: true,
      proposedContent: true,
      createdAt: true,
      reviewedAt: true,
      suggestedBy: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
      reviewedBy: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
    },
  });

  return NextResponse.json({ suggestions });
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
    return NextResponse.json(
      { error: "No suggestion access" },
      { status: 403 },
    );
  }

  const body = await readJsonBody<CreateSuggestionInput>(request);
  const hasCustomContent =
    (typeof body?.proposedText === "string" &&
      body.proposedText.trim().length > 0) ||
    (body?.proposedContent !== null &&
      typeof body?.proposedContent === "object");
  const proposedTitle = normalizeTitle(body?.proposedTitle);

  if (!proposedTitle && !hasCustomContent) {
    return NextResponse.json(
      { error: "Suggestion must include a title or content change" },
      { status: 400 },
    );
  }

  const suggestion = await db.documentSuggestion.create({
    data: {
      documentId: id,
      suggestedById: user.id,
      proposedTitle,
      proposedContent: normalizeSuggestedContent(
        body?.proposedContent,
        body?.proposedText,
      ),
    },
    select: {
      id: true,
      status: true,
      proposedTitle: true,
      proposedContent: true,
      createdAt: true,
      reviewedAt: true,
      suggestedBy: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
      reviewedBy: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
    },
  });

  await broadcastSuggestionEvent(id, {
    action: "created",
    suggestionId: suggestion.id,
  });

  return NextResponse.json({ suggestion }, { status: 201 });
}
