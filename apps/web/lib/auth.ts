import NextAuth, { type Session } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { db } from "@repo/db";

const normalizeEmail = (value: unknown) => {
  if (typeof value !== "string") {
    return null;
  }

  const email = value.trim().toLowerCase();

  if (!email || !email.includes("@")) {
    return null;
  }

  return email;
};

const authResult = NextAuth({
  providers: [
    Credentials({
      name: "Email",
      credentials: {
        email: { label: "Email", type: "email" },
      },
      async authorize(credentials) {
        const email = normalizeEmail(credentials?.email);

        if (!email) {
          return null;
        }

        const user = await db.user.upsert({
          where: { email },
          update: {},
          create: {
            email,
            name: email.split("@")[0] ?? "User",
          },
        });

        return {
          id: user.id,
          email: user.email,
          name: user.name,
        };
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/sign-in",
  },
});

export const handlers = authResult.handlers;

export const getSession = async (): Promise<Session | null> => {
  return authResult.auth();
};

export const signInWithEmail = async (email: string, redirectTo = "/") => {
  return authResult.signIn("credentials", { email, redirectTo });
};

export const signOutUser = async (redirectTo = "/sign-in") => {
  return authResult.signOut({ redirectTo });
};
