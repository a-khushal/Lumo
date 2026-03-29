import { NextResponse } from "next/server";
import { db, Prisma } from "@repo/db";
import { z } from "zod";
import {
  canEditDocument,
  emptyDocContent,
  getDocumentAccess,
  toDocContentFromText,
} from "../../../../lib/document-access";
import { getCurrentUser } from "../../../../lib/current-user";
import { docIdParamsSchema } from "../../../../lib/route-params";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const updateDocSchema = z
  .object({
    title: z.string().trim().max(120).optional(),
    content: z.unknown().optional(),
  })
  .refine(
    (value: { title?: string; content?: unknown }) =>
      value.title !== undefined || value.content !== undefined,
    {
      message: "At least one of title or content is required",
    },
  );

const normalizeTitle = (title: unknown) => {
  if (typeof title !== "string") {
    return null;
  }

  const trimmed = title.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 120) : "Untitled document";
};

const normalizeContent = (content: unknown): Prisma.InputJsonValue => {
  if (typeof content === "string") {
    return toDocContentFromText(content);
  }

  if (content && typeof content === "object") {
    return content as Prisma.InputJsonValue;
  }

  return emptyDocContent;
};

const readJsonBody = async <T>(request: Request): Promise<T | null> => {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
};

export async function GET(_request: Request, context: RouteContext) {
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

  const document = await db.document.findFirst({
    where: {
      id,
      OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }],
      isArchived: false,
    },
    select: {
      id: true,
      title: true,
      content: true,
      updatedAt: true,
      createdAt: true,
    },
  });

  if (!document) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  return NextResponse.json({ document });
}

export async function PATCH(request: Request, context: RouteContext) {
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

  const body = await readJsonBody<unknown>(request);
  const parsedBody = updateDocSchema.safeParse(body ?? {});

  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsedBody.error.flatten() },
      { status: 400 },
    );
  }

  const access = await getDocumentAccess({
    documentId: id,
    userId: user.id,
  });

  if (!access || !canEditDocument(access.role)) {
    return NextResponse.json({ error: "No edit access" }, { status: 403 });
  }

  const updateData: Prisma.DocumentUpdateInput = {};
  const nextTitle = normalizeTitle(parsedBody.data.title);

  if (nextTitle !== null) {
    updateData.title = nextTitle;
  }

  if (parsedBody.data.content !== undefined) {
    updateData.content = normalizeContent(parsedBody.data.content);
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const document = await db.document.update({
    where: {
      id,
    },
    data: updateData,
    select: {
      id: true,
      title: true,
      content: true,
      updatedAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    document,
    updatedAt: document.updatedAt.toISOString(),
  });
}
