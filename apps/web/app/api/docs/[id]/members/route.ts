import { NextResponse } from "next/server";
import { db } from "@repo/db";
import { getCurrentUser } from "../../../../../lib/current-user";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type InviteMemberInput = {
  email?: unknown;
  role?: unknown;
};

const ALLOWED_MEMBER_ROLES = ["EDITOR", "COMMENTER", "VIEWER"] as const;

const normalizeEmail = (email: unknown) => {
  if (typeof email !== "string") {
    return null;
  }

  const value = email.trim().toLowerCase();

  if (!value || !value.includes("@")) {
    return null;
  }

  return value;
};

const normalizeRole = (role: unknown) => {
  if (typeof role !== "string") {
    return "EDITOR";
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

const getOrCreateUserByEmail = async (email: string) => {
  return db.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: email.split("@")[0] ?? "Member",
    },
  });
};

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const { id } = await context.params;
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const document = await db.document.findFirst({
    where: {
      id,
      isArchived: false,
      OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }],
    },
    select: {
      id: true,
      owner: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
      members: {
        orderBy: {
          createdAt: "asc",
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
      },
    },
  });

  if (!document) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  return NextResponse.json({
    owner: {
      role: "OWNER",
      user: document.owner,
    },
    members: document.members,
  });
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { id } = await context.params;
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const document = await db.document.findFirst({
    where: {
      id,
      ownerId: user.id,
      isArchived: false,
    },
    select: {
      id: true,
      ownerId: true,
    },
  });

  if (!document) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const body = await readJsonBody<InviteMemberInput>(request);
  const email = normalizeEmail(body?.email);
  const role = normalizeRole(body?.role);

  if (!email) {
    return NextResponse.json(
      { error: "Valid email is required" },
      { status: 400 },
    );
  }

  if (!role) {
    return NextResponse.json(
      { error: "Role must be one of EDITOR, COMMENTER, VIEWER" },
      { status: 400 },
    );
  }

  const invitedUser = await getOrCreateUserByEmail(email);

  if (invitedUser.id === document.ownerId) {
    return NextResponse.json(
      { error: "Owner already has full access" },
      { status: 400 },
    );
  }

  const existingMember = await db.documentMember.findUnique({
    where: {
      documentId_userId: {
        documentId: document.id,
        userId: invitedUser.id,
      },
    },
    select: {
      id: true,
    },
  });

  const member = existingMember
    ? await db.documentMember.update({
        where: {
          id: existingMember.id,
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
      })
    : await db.documentMember.create({
        data: {
          documentId: document.id,
          userId: invitedUser.id,
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

  return NextResponse.json({ member }, { status: existingMember ? 200 : 201 });
}
