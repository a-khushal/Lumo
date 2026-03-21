import { NextResponse } from "next/server";
import { db, Prisma } from "@repo/db";
import { getCurrentUser } from "../../../../lib/current-user";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type UpdateDocInput = {
  title?: unknown;
  content?: unknown;
};

const normalizeTitle = (title: unknown) => {
  if (typeof title !== "string") {
    return null;
  }

  const trimmed = title.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 120) : "Untitled document";
};

const normalizeContent = (content: unknown): Prisma.InputJsonValue => {
  if (typeof content === "string") {
    return { text: content };
  }

  if (content && typeof content === "object") {
    return content as Prisma.InputJsonValue;
  }

  return { text: "" };
};

const readJsonBody = async <T>(request: Request): Promise<T | null> => {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
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
  const { id } = await context.params;
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await readJsonBody<UpdateDocInput>(request);

  const editorAccess = await db.document.findFirst({
    where: {
      id,
      OR: [
        { ownerId: user.id },
        {
          members: {
            some: {
              userId: user.id,
              role: { in: ["OWNER", "EDITOR"] },
            },
          },
        },
      ],
      isArchived: false,
    },
    select: {
      id: true,
    },
  });

  if (!editorAccess) {
    return NextResponse.json({ error: "No edit access" }, { status: 403 });
  }

  const updateData: Prisma.DocumentUpdateInput = {};
  const nextTitle = normalizeTitle(body?.title);

  if (nextTitle !== null) {
    updateData.title = nextTitle;
  }

  if (body && "content" in body) {
    updateData.content = normalizeContent(body.content);
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
