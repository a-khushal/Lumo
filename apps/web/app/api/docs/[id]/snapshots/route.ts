import { NextResponse } from "next/server";
import { db, Prisma } from "@repo/db";
import { getCurrentUser } from "../../../../../lib/current-user";

type RouteContext = {
  params: Promise<{ id: string }>;
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

  const document = await db.document.findFirst({
    where: {
      id,
      isArchived: false,
      OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }],
    },
    select: {
      id: true,
    },
  });

  if (!document) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const snapshots = await db.documentSnapshot.findMany({
    where: {
      documentId: id,
    },
    orderBy: {
      version: "desc",
    },
    take: 50,
    select: {
      id: true,
      version: true,
      createdAt: true,
      createdBy: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
    },
  });

  return NextResponse.json({ snapshots });
}

export async function POST(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;

  const document = await db.document.findFirst({
    where: {
      id,
      isArchived: false,
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
    },
    select: {
      id: true,
      content: true,
    },
  });

  if (!document) {
    return NextResponse.json({ error: "No edit access" }, { status: 403 });
  }

  const snapshot = await db.$transaction(async (tx) => {
    const latest = await tx.documentSnapshot.findFirst({
      where: {
        documentId: id,
      },
      orderBy: {
        version: "desc",
      },
      select: {
        version: true,
      },
    });

    const nextVersion = (latest?.version ?? 0) + 1;

    return tx.documentSnapshot.create({
      data: {
        documentId: id,
        createdById: user.id,
        version: nextVersion,
        content: document.content as Prisma.InputJsonValue,
      },
      select: {
        id: true,
        version: true,
        createdAt: true,
        createdBy: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });
  });

  return NextResponse.json({ snapshot }, { status: 201 });
}
