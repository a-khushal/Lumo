import { redirect } from "next/navigation";
import { db } from "@repo/db";
import { getSession } from "./auth";

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

export const getCurrentUser = async () => {
  const session = await getSession();
  const email = normalizeEmail(session?.user?.email);

  if (!email) {
    return null;
  }

  return db.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: session?.user?.name ?? email.split("@")[0] ?? "User",
    },
  });
};

export const requireCurrentUser = async () => {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/sign-in");
  }

  return user;
};
