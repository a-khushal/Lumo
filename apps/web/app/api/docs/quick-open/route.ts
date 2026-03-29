import { NextResponse } from "next/server";
import { db } from "@repo/db";
import { z } from "zod";
import { getCurrentUser } from "../../../../lib/current-user";

const querySchema = z.object({
  q: z.string().trim().max(80).optional(),
});

export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const parsedQuery = querySchema.safeParse({
    q: url.searchParams.get("q") ?? undefined,
  });

  if (!parsedQuery.success) {
    return NextResponse.json(
      { error: "Invalid query params", details: parsedQuery.error.flatten() },
      { status: 400 },
    );
  }

  const searchTerm = parsedQuery.data.q?.trim() || null;

  const documents = await db.document.findMany({
    where: {
      isArchived: false,
      OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }],
      ...(searchTerm
        ? {
            title: {
              contains: searchTerm,
              mode: "insensitive" as const,
            },
          }
        : {}),
    },
    select: {
      id: true,
      title: true,
      ownerId: true,
      owner: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
      updatedAt: true,
      members: {
        where: {
          userId: user.id,
        },
        select: {
          role: true,
        },
        take: 1,
      },
    },
    orderBy: {
      updatedAt: "desc",
    },
    take: 20,
  });

  return NextResponse.json({
    documents: documents.map((document) => ({
      id: document.id,
      title: document.title,
      updatedAt: document.updatedAt.toISOString(),
      owner: {
        id: document.owner.id,
        name: document.owner.name,
        email: document.owner.email,
      },
      visibility: document.ownerId === user.id ? "owned" : "shared",
      role: document.ownerId === user.id ? "OWNER" : document.members[0]?.role,
    })),
  });
}
