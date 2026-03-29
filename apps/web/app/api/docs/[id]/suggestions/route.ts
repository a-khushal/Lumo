import { NextResponse } from "next/server";
import { db, type Prisma } from "@repo/db";
import { z } from "zod";
import { broadcastSuggestionEvent } from "../../../../../lib/collab-broadcast";
import {
  canCommentOnDocument,
  getDocumentAccess,
  toDocContentFromText,
} from "../../../../../lib/document-access";
import { getCurrentUser } from "../../../../../lib/current-user";
import { docIdParamsSchema } from "../../../../../lib/route-params";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const createSuggestionSchema = z.object({
  proposedTitle: z.string().trim().max(120).optional().nullable(),
  proposedContent: z.record(z.string(), z.unknown()).optional().nullable(),
  proposedText: z.string().trim().max(20000).optional().nullable(),
});

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
  const parsedParams = docIdParamsSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return NextResponse.json(
      { error: "Invalid route params", details: parsedParams.error.flatten() },
      { status: 400 },
    );
  }

  const { id } = parsedParams.data;
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
  const parsedParams = docIdParamsSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return NextResponse.json(
      { error: "Invalid route params", details: parsedParams.error.flatten() },
      { status: 400 },
    );
  }

  const { id } = parsedParams.data;
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  const body = await readJsonBody<unknown>(request);
  const parsedBody = createSuggestionSchema.safeParse(body ?? {});

  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsedBody.error.flatten() },
      { status: 400 },
    );
  }

  const hasCustomContent =
    (typeof parsedBody.data.proposedText === "string" &&
      parsedBody.data.proposedText.trim().length > 0) ||
    (parsedBody.data.proposedContent !== null &&
      parsedBody.data.proposedContent !== undefined &&
      typeof parsedBody.data.proposedContent === "object");
  const proposedTitle = normalizeTitle(parsedBody.data.proposedTitle);

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
        parsedBody.data.proposedContent,
        parsedBody.data.proposedText,
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
