import { NextResponse } from "next/server";
import { db, Prisma } from "@repo/db";
import { getCurrentUser } from "../../../../../../../lib/current-user";
import { docSnapshotParamsSchema } from "../../../../../../../lib/route-params";

type RouteContext = {
  params: Promise<{ id: string; snapshotId: string }>;
};

export async function POST(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const parsedParams = docSnapshotParamsSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return NextResponse.json(
      { error: "Invalid route params", details: parsedParams.error.flatten() },
      { status: 400 },
    );
  }

  const { id, snapshotId } = parsedParams.data;
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
      title: true,
    },
  });

  if (!document) {
    return NextResponse.json({ error: "No edit access" }, { status: 403 });
  }

  const targetSnapshot = await db.documentSnapshot.findFirst({
    where: {
      id: snapshotId,
      documentId: id,
    },
    select: {
      id: true,
      version: true,
      content: true,
    },
  });

  if (!targetSnapshot) {
    return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });
  }

  const result = await db.$transaction(async (tx) => {
    const updatedDocument = await tx.document.update({
      where: {
        id,
      },
      data: {
        content: targetSnapshot.content as Prisma.InputJsonValue,
      },
      select: {
        id: true,
        title: true,
        content: true,
        updatedAt: true,
      },
    });

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

    const restoreSnapshot = await tx.documentSnapshot.create({
      data: {
        documentId: id,
        createdById: user.id,
        version: (latest?.version ?? 0) + 1,
        content: updatedDocument.content as Prisma.InputJsonValue,
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

    return {
      document: updatedDocument,
      snapshot: restoreSnapshot,
    };
  });

  return NextResponse.json({
    document: result.document,
    snapshot: result.snapshot,
    restoredFromVersion: targetSnapshot.version,
  });
}
