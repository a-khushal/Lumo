import { NextResponse } from "next/server";
import { db } from "@repo/db";
import { z } from "zod";
import {
  canManageDocumentMembers,
  getDocumentAccess,
} from "../../../../../lib/document-access";
import { getCurrentUser } from "../../../../../lib/current-user";
import { docIdParamsSchema } from "../../../../../lib/route-params";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const ALLOWED_MEMBER_ROLES = ["EDITOR", "COMMENTER", "VIEWER"] as const;

const inviteMemberSchema = z.object({
  email: z.string().trim().email().max(320),
  role: z.enum(ALLOWED_MEMBER_ROLES).optional(),
});

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

  const access = await getDocumentAccess({ documentId: id, userId: user.id });

  if (!access) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const document = await db.document.findFirst({
    where: {
      id,
      isArchived: false,
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

  const access = await getDocumentAccess({ documentId: id, userId: user.id });

  if (!access) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  if (!canManageDocumentMembers(access.role)) {
    return NextResponse.json({ error: "No member access" }, { status: 403 });
  }

  const body = await readJsonBody<unknown>(request);
  const parsedBody = inviteMemberSchema.safeParse(body ?? {});

  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsedBody.error.flatten() },
      { status: 400 },
    );
  }

  const email = normalizeEmail(parsedBody.data.email);
  const role = normalizeRole(parsedBody.data.role);

  if (!email || !role) {
    return NextResponse.json(
      { error: "Role must be one of EDITOR, COMMENTER, VIEWER" },
      { status: 400 },
    );
  }

  const invitedUser = await getOrCreateUserByEmail(email);

  if (invitedUser.id === user.id) {
    return NextResponse.json(
      { error: "Owner already has full access" },
      { status: 400 },
    );
  }

  const existingMember = await db.documentMember.findUnique({
    where: {
      documentId_userId: {
        documentId: id,
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
          documentId: id,
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
