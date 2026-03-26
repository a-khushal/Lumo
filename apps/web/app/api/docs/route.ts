import { NextResponse } from "next/server";
import { db, Prisma } from "@repo/db";
import { getCurrentUser } from "../../../lib/current-user";

type CreateDocInput = {
  title?: unknown;
};

const readJsonBody = async <T>(request: Request): Promise<T | null> => {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
};

const normalizeTitle = (title: unknown) => {
  if (typeof title !== "string") {
    return "Untitled document";
  }

  const trimmed = title.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 120) : "Untitled document";
};

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const documents = await db.document.findMany({
    where: {
      ownerId: user.id,
      isArchived: false,
    },
    select: {
      id: true,
      title: true,
      updatedAt: true,
      createdAt: true,
    },
    orderBy: {
      updatedAt: "desc",
    },
  });

  const readStates = await db.documentCommentRead.findMany({
    where: {
      userId: user.id,
      documentId: {
        in: documents.map((document) => document.id),
      },
    },
    select: {
      documentId: true,
      lastReadAt: true,
    },
  });

  const readMap = new Map(
    readStates.map((state) => [state.documentId, state.lastReadAt]),
  );

  const documentsWithUnread = await Promise.all(
    documents.map(async (document) => {
      const unreadCount = await db.documentComment.count({
        where: {
          documentId: document.id,
          authorId: {
            not: user.id,
          },
          createdAt: {
            gt: readMap.get(document.id) ?? new Date(0),
          },
        },
      });

      return {
        ...document,
        unreadCount,
      };
    }),
  );

  return NextResponse.json({ documents: documentsWithUnread });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await readJsonBody<CreateDocInput>(request);

  const document = await db.document.create({
    data: {
      ownerId: user.id,
      title: normalizeTitle(body?.title),
      content: {
        type: "doc",
        content: [{ type: "paragraph" }],
      } satisfies Prisma.InputJsonValue,
    },
    select: {
      id: true,
      title: true,
      updatedAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ document }, { status: 201 });
}
