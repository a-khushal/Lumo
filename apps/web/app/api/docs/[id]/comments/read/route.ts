import { NextResponse } from "next/server";
import { db } from "@repo/db";
import { getDocumentAccess } from "../../../../../../lib/document-access";
import { getCurrentUser } from "../../../../../../lib/current-user";
import { docIdParamsSchema } from "../../../../../../lib/route-params";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(
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
