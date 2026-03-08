import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

type GlobalForDb = {
  db?: PrismaClient;
};

const globalForDb = globalThis as GlobalForDb;

const createDbClient = () => {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
};

export const db = globalForDb.db ?? createDbClient();

if (process.env.NODE_ENV !== "production") {
  globalForDb.db = db;
}

export { Prisma } from "./generated/prisma/client";
