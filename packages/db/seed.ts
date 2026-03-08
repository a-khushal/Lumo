import "dotenv/config";
import { db } from "./index";

const DEMO_USER_EMAIL = process.env.DEMO_USER_EMAIL ?? "demo@docs.local";
const DEMO_USER_NAME = process.env.DEMO_USER_NAME ?? "Demo User";

async function main() {
  const user = await db.user.upsert({
    where: { email: DEMO_USER_EMAIL },
    update: {},
    create: {
      email: DEMO_USER_EMAIL,
      name: DEMO_USER_NAME,
    },
  });

  const existingDocs = await db.document.count({
    where: { ownerId: user.id },
  });

  if (existingDocs === 0) {
    await db.document.createMany({
      data: [
        {
          ownerId: user.id,
          title: "Getting Started",
          content: { text: "Welcome to your docs MVP." },
        },
        {
          ownerId: user.id,
          title: "Product Notes",
          content: { text: "Capture roadmap ideas here." },
        },
      ],
    });
  }

  console.log(`Seeded demo user ${DEMO_USER_EMAIL}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
