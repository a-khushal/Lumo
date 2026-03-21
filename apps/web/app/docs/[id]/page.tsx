import { notFound } from "next/navigation";
import { db } from "@repo/db";
import { createCollabToken } from "../../../lib/collab-token";
import { requireCurrentUser } from "../../../lib/current-user";
import { DocumentEditor } from "./document-editor";

export const dynamic = "force-dynamic";

type DocumentPageProps = {
  params: Promise<{ id: string }>;
};

export default async function DocumentPage({ params }: DocumentPageProps) {
  const { id } = await params;
  const user = await requireCurrentUser();

  const document = await db.document.findFirst({
    where: {
      id,
      OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }],
      isArchived: false,
    },
    select: {
      id: true,
      title: true,
      content: true,
      updatedAt: true,
      ownerId: true,
      members: {
        where: {
          userId: user.id,
        },
        select: {
          role: true,
        },
      },
    },
  });

  if (!document) {
    notFound();
  }

  const currentUserRole =
    document.ownerId === user.id
      ? "OWNER"
      : (document.members[0]?.role ?? "VIEWER");

  const collabToken = await createCollabToken({
    userId: user.id,
    documentId: document.id,
  });

  return (
    <DocumentEditor
      documentId={document.id}
      currentUserId={user.id}
      currentUserEmail={user.email}
      currentUserName={user.name}
      collabToken={collabToken}
      currentUserRole={currentUserRole}
      initialContent={document.content}
      initialTitle={document.title}
      updatedAt={document.updatedAt.toISOString()}
    />
  );
}
