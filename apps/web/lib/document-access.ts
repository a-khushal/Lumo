import { db, type Prisma } from "@repo/db";

export type DocumentRole = "OWNER" | "EDITOR" | "COMMENTER" | "VIEWER";

export type DocumentAccess = {
  documentId: string;
  role: DocumentRole;
};

export const canViewDocument = () => {
  return true;
};

export const canEditDocument = (role: DocumentRole) => {
  return role === "OWNER" || role === "EDITOR";
};

export const canCommentOnDocument = (role: DocumentRole) => {
  return role === "OWNER" || role === "EDITOR" || role === "COMMENTER";
};

export const canManageDocumentMembers = (role: DocumentRole) => {
  return role === "OWNER";
};

export const canReviewSuggestions = (role: DocumentRole) => {
  return role === "OWNER" || role === "EDITOR";
};

const resolveRole = (
  ownerId: string,
  userId: string,
  memberRole?: DocumentRole,
) => {
  if (ownerId === userId) {
    return "OWNER" as const;
  }

  return memberRole ?? null;
};

export const getDocumentAccess = async ({
  documentId,
  userId,
}: {
  documentId: string;
  userId: string;
}): Promise<DocumentAccess | null> => {
  const document = await db.document.findFirst({
    where: {
      id: documentId,
      isArchived: false,
      OR: [{ ownerId: userId }, { members: { some: { userId } } }],
    },
    select: {
      id: true,
      ownerId: true,
      members: {
        where: {
          userId,
        },
        select: {
          role: true,
        },
        take: 1,
      },
    },
  });

  if (!document) {
    return null;
  }

  const role = resolveRole(
    document.ownerId,
    userId,
    document.members[0]?.role as DocumentRole | undefined,
  );

  if (!role) {
    return null;
  }

  return {
    documentId: document.id,
    role,
  };
};

export const emptyDocContent = {
  type: "doc",
  content: [{ type: "paragraph" }],
} satisfies Prisma.InputJsonValue;

export const toDocContentFromText = (text: string): Prisma.InputJsonValue => {
  const trimmed = text.trim();

  if (!trimmed) {
    return emptyDocContent;
  }

  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: trimmed }],
      },
    ],
  } satisfies Prisma.InputJsonValue;
};
