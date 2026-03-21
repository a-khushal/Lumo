import { SignJWT } from "jose";

const getCollabSecret = () => {
  const value = process.env.COLLAB_TOKEN_SECRET ?? process.env.NEXTAUTH_SECRET;

  if (!value) {
    throw new Error(
      "COLLAB_TOKEN_SECRET (or NEXTAUTH_SECRET) is required for collaboration auth",
    );
  }

  return new TextEncoder().encode(value);
};

export const createCollabToken = async ({
  userId,
  documentId,
}: {
  userId: string;
  documentId: string;
}) => {
  return new SignJWT({
    doc: documentId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer("docs-web")
    .setAudience("docs-collab")
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(getCollabSecret());
};
