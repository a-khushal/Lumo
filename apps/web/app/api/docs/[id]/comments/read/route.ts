import { NextResponse } from "next/server";
import { db } from "@repo/db";
import { getDocumentAccess } from "../../../../../../lib/document-access";
import { getCurrentUser } from "../../../../../../lib/current-user";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;

  const access = await getDocumentAccess({
    documentId: id,
    userId: user.id,
  });

  if (!access) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const readState = await db.documentCommentRead.upsert({
    where: {
      documentId_userId: {
        documentId: id,
        userId: user.id,
      },
    },
    update: {
      lastReadAt: new Date(),
    },
    create: {
      documentId: id,
      userId: user.id,
      lastReadAt: new Date(),
    },
    select: {
      lastReadAt: true,
    },
  });

  return NextResponse.json({ lastReadAt: readState.lastReadAt });
}
