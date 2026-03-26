import { notFound } from "next/navigation";
import { db } from "@repo/db";
import { createCollabToken } from "../../../lib/collab-token";
import { getDocumentAccess } from "../../../lib/document-access";
import { requireCurrentUser } from "../../../lib/current-user";
import { DocumentEditor } from "./document-editor";

export const dynamic = "force-dynamic";

type DocumentPageProps = {
  params: Promise<{ id: string }>;
};

export default async function DocumentPage({ params }: DocumentPageProps) {
  const { id } = await params;
  const user = await requireCurrentUser();

  const access = await getDocumentAccess({
    documentId: id,
    userId: user.id,
  });

  if (!access) {
    notFound();
  }

  const document = await db.document.findFirst({
    where: {
      id,
      isArchived: false,
    },
    select: {
      id: true,
      title: true,
      content: true,
      updatedAt: true,
    },
  });

  if (!document) {
    notFound();
  }

  const currentUserRole = access.role;

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
