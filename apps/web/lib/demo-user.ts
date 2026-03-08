import { db } from "@repo/db";

const DEMO_USER_EMAIL = process.env.DEMO_USER_EMAIL ?? "demo@docs.local";
const DEMO_USER_NAME = process.env.DEMO_USER_NAME ?? "Demo User";

export const getOrCreateDemoUser = async () => {
  return db.user.upsert({
    where: { email: DEMO_USER_EMAIL },
    update: {},
    create: {
      email: DEMO_USER_EMAIL,
      name: DEMO_USER_NAME,
    },
  });
};
