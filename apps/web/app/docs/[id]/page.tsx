import { notFound } from "next/navigation";
import { db } from "@repo/db";
import { getOrCreateDemoUser } from "../../../lib/demo-user";
import { DocumentEditor } from "./document-editor";

type DocumentPageProps = {
  params: Promise<{ id: string }>;
};

const getTextContent = (value: unknown) => {
  if (typeof value === "string") {
    return value;
  }

  if (
    value &&
    typeof value === "object" &&
    "text" in value &&
    typeof value.text === "string"
  ) {
    return value.text;
  }

  return "";
};

export default async function DocumentPage({ params }: DocumentPageProps) {
  const { id } = await params;
  const user = await getOrCreateDemoUser();

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
    },
  });

  if (!document) {
    notFound();
  }

  return (
    <DocumentEditor
      documentId={document.id}
      initialText={getTextContent(document.content)}
      initialTitle={document.title}
      updatedAt={document.updatedAt.toISOString()}
    />
  );
}
