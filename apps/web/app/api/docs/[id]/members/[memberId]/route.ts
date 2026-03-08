import { NextResponse } from "next/server";
import { db } from "@repo/db";
import { getOrCreateDemoUser } from "../../../../../../lib/demo-user";

type RouteContext = {
  params: Promise<{ id: string; memberId: string }>;
};

type UpdateMemberInput = {
  role?: unknown;
};

const ALLOWED_MEMBER_ROLES = ["EDITOR", "COMMENTER", "VIEWER"] as const;

const normalizeRole = (role: unknown) => {
  if (typeof role !== "string") {
    return null;
  }

  const normalized = role.trim().toUpperCase();

  if (ALLOWED_MEMBER_ROLES.includes(normalized as (typeof ALLOWED_MEMBER_ROLES)[number])) {
    return normalized as (typeof ALLOWED_MEMBER_ROLES)[number];
  }

  return null;
};

const readJsonBody = async <T>(request: Request): Promise<T | null> => {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
};

const ensureOwnerAccess = async (documentId: string, userId: string) => {
  return db.document.findFirst({
    where: {
      id: documentId,
      ownerId: userId,
      isArchived: false,
    },
    select: {
      id: true,
    },
  });
};

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { id, memberId } = await context.params;
  const user = await getOrCreateDemoUser();
  const body = await readJsonBody<UpdateMemberInput>(request);
  const role = normalizeRole(body?.role);

  if (!role) {
    return NextResponse.json(
      { error: "Role must be one of EDITOR, COMMENTER, VIEWER" },
      { status: 400 },
    );
  }

  const ownerAccess = await ensureOwnerAccess(id, user.id);

  if (!ownerAccess) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const member = await db.documentMember.findFirst({
    where: {
      id: memberId,
      documentId: id,
    },
    select: {
      id: true,
    },
  });

  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  const updatedMember = await db.documentMember.update({
    where: {
      id: member.id,
    },
    data: {
      role,
    },
    select: {
      id: true,
      role: true,
      createdAt: true,
      user: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
    },
  });

  return NextResponse.json({ member: updatedMember });
}

export async function DELETE(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const { id, memberId } = await context.params;
  const user = await getOrCreateDemoUser();

  const ownerAccess = await ensureOwnerAccess(id, user.id);

  if (!ownerAccess) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const member = await db.documentMember.findFirst({
    where: {
      id: memberId,
      documentId: id,
    },
    select: {
      id: true,
    },
  });

  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  await db.documentMember.delete({
    where: {
      id: member.id,
    },
  });

  return NextResponse.json({ success: true });
}
