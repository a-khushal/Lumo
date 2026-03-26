import { NextResponse } from "next/server";
import { db, type Prisma } from "@repo/db";
import { broadcastSuggestionEvent } from "../../../../../../lib/collab-broadcast";
import {
  canReviewSuggestions,
  getDocumentAccess,
} from "../../../../../../lib/document-access";
import { getCurrentUser } from "../../../../../../lib/current-user";

type RouteContext = {
  params: Promise<{ id: string; suggestionId: string }>;
};

type ReviewSuggestionInput = {
  action?: unknown;
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

  const { id, suggestionId } = await context.params;
  const access = await getDocumentAccess({ documentId: id, userId: user.id });

  if (!access) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  if (!canReviewSuggestions(access.role)) {
    return NextResponse.json(
      { error: "No suggestion review access" },
      { status: 403 },
    );
  }

  const body = await readJsonBody<ReviewSuggestionInput>(request);
  const action = typeof body?.action === "string" ? body.action : null;

  if (action !== "accept" && action !== "reject") {
    return NextResponse.json(
      { error: "action must be accept or reject" },
      { status: 400 },
    );
  }

  const suggestion = await db.documentSuggestion.findFirst({
    where: {
      id: suggestionId,
      documentId: id,
    },
    select: {
      id: true,
      status: true,
      proposedTitle: true,
      proposedContent: true,
    },
  });

  if (!suggestion) {
    return NextResponse.json(
      { error: "Suggestion not found" },
      { status: 404 },
    );
  }

  if (suggestion.status !== "OPEN") {
    return NextResponse.json(
      { error: "Suggestion already reviewed" },
      { status: 409 },
    );
  }

  const result = await db.$transaction(async (tx) => {
    if (action === "accept") {
      await tx.document.update({
        where: { id },
        data: {
          title: suggestion.proposedTitle ?? undefined,
          content: suggestion.proposedContent as Prisma.InputJsonValue,
        },
      });
    }

    return tx.documentSuggestion.update({
      where: {
        id: suggestion.id,
      },
      data: {
        status: action === "accept" ? "ACCEPTED" : "REJECTED",
        reviewedAt: new Date(),
        reviewedById: user.id,
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
  });

  await broadcastSuggestionEvent(id, {
    action: "reviewed",
    suggestionId: result.id,
  });

  return NextResponse.json({ suggestion: result, action });
}
