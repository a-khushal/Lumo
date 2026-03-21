import { existsSync } from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { Server } from "@hocuspocus/server";
import { TiptapTransformer } from "@hocuspocus/transformer";
import { jwtVerify, type JWTPayload } from "jose";
import type { Prisma } from "@repo/db";

const envCandidates = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "../web/.env.local"),
  path.resolve(process.cwd(), "../../.env"),
];

envCandidates.forEach((filePath) => {
  if (existsSync(filePath)) {
    loadEnv({ path: filePath, override: false, quiet: true });
  }
});

const { db } = await import("@repo/db");

const COLLAB_PORT = Number(process.env.COLLAB_PORT ?? 1234);

const getCollabSecret = () => {
  const value = process.env.COLLAB_TOKEN_SECRET ?? process.env.NEXTAUTH_SECRET;

  if (!value) {
    throw new Error(
      "COLLAB_TOKEN_SECRET (or NEXTAUTH_SECRET) is required for collaboration auth",
    );
  }

  return new TextEncoder().encode(value);
};

type CollabPayload = JWTPayload & {
  doc?: unknown;
};

const verifyCollabToken = async (token: string, documentId: string) => {
  const { payload } = await jwtVerify<CollabPayload>(token, getCollabSecret(), {
    issuer: "docs-web",
    audience: "docs-collab",
  });

  const userId = payload.sub;

  if (typeof userId !== "string" || !userId) {
    throw new Error("Unauthorized");
  }

  if (payload.doc !== documentId) {
    throw new Error("Unauthorized");
  }

  return userId;
};

const emptyDocument: Prisma.InputJsonValue = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

const normalizeJson = (value: Prisma.JsonValue): Prisma.InputJsonValue => {
  if (value && typeof value === "object") {
    return value as Prisma.InputJsonValue;
  }

  return emptyDocument;
};

const hasAccess = async (documentId: string, userId: string) => {
  const document = await db.document.findFirst({
    where: {
      id: documentId,
      isArchived: false,
      OR: [{ ownerId: userId }, { members: { some: { userId } } }],
    },
    select: {
      id: true,
    },
  });

  return Boolean(document);
};

const server = new Server({
  port: COLLAB_PORT,
  async onAuthenticate({
    token,
    documentName,
  }: {
    token: unknown;
    documentName: string;
  }) {
    if (typeof token !== "string" || !token) {
      throw new Error("Unauthorized");
    }

    let userId = "";

    try {
      userId = await verifyCollabToken(token, documentName);
    } catch {
      throw new Error("Unauthorized");
    }

    const access = await hasAccess(documentName, userId);

    if (!access) {
      throw new Error("Forbidden");
    }

    return {
      user: {
        id: userId,
      },
    };
  },
  async onLoadDocument({ documentName }: { documentName: string }) {
    const document = await db.document.findFirst({
      where: {
        id: documentName,
        isArchived: false,
      },
      select: {
        content: true,
      },
    });

    if (!document) {
      throw new Error("Document not found");
    }

    return TiptapTransformer.toYdoc(normalizeJson(document.content), "default");
  },
  async onStoreDocument({
    documentName,
    document,
  }: {
    documentName: string;
    document: unknown;
  }) {
    const content = TiptapTransformer.fromYdoc(
      document as Parameters<typeof TiptapTransformer.fromYdoc>[0],
      "default",
    );

    await db.document.update({
      where: {
        id: documentName,
      },
      data: {
        content: content as Prisma.InputJsonValue,
      },
    });
  },
});

server.listen();

console.log(`[collab] Hocuspocus listening on ws://localhost:${COLLAB_PORT}`);
