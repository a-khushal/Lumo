import { NextResponse } from "next/server";
import { db } from "@repo/db";
import { z } from "zod";
import {
  canManageDocumentMembers,
  getDocumentAccess,
} from "../../../../../../lib/document-access";
import { getCurrentUser } from "../../../../../../lib/current-user";

type RouteContext = {
  params: Promise<{ id: string; memberId: string }>;
};

const ALLOWED_MEMBER_ROLES = ["EDITOR", "COMMENTER", "VIEWER"] as const;

const updateMemberSchema = z.object({
  role: z.enum(ALLOWED_MEMBER_ROLES),
});

const normalizeRole = (role: unknown) => {
  if (typeof role !== "string") {
    return null;
  }

  const normalized = role.trim().toUpperCase();

  if (
    ALLOWED_MEMBER_ROLES.includes(
      normalized as (typeof ALLOWED_MEMBER_ROLES)[number],
    )
  ) {
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

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { id, memberId } = await context.params;
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await readJsonBody<unknown>(request);
  const parsedBody = updateMemberSchema.safeParse(body ?? {});

  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsedBody.error.flatten() },
      { status: 400 },
    );
  }

  const role = normalizeRole(parsedBody.data.role);

  if (!role) {
    return NextResponse.json(
      { error: "Role must be one of EDITOR, COMMENTER, VIEWER" },
      { status: 400 },
    );
  }

  const access = await getDocumentAccess({ documentId: id, userId: user.id });

  if (!access) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  if (!canManageDocumentMembers(access.role)) {
    return NextResponse.json({ error: "No member access" }, { status: 403 });
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
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await getDocumentAccess({ documentId: id, userId: user.id });

  if (!access) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  if (!canManageDocumentMembers(access.role)) {
    return NextResponse.json({ error: "No member access" }, { status: 403 });
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
