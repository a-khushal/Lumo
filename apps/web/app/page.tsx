import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@repo/db";
import { getOrCreateDemoUser } from "../lib/demo-user";

const createDocument = async () => {
  "use server";

  const user = await getOrCreateDemoUser();

  const document = await db.document.create({
    data: {
      ownerId: user.id,
      title: "Untitled document",
      content: { text: "" },
    },
    select: {
      id: true,
    },
  });

  redirect(`/docs/${document.id}`);
};

export default async function Home() {
  const user = await getOrCreateDemoUser();

  const documents = await db.document.findMany({
    where: {
      ownerId: user.id,
      isArchived: false,
    },
    select: {
      id: true,
      title: true,
      updatedAt: true,
    },
    orderBy: {
      updatedAt: "desc",
    },
  });

  return (
    <main className="dashboard">
      <header className="dashboardHeader">
        <div>
          <p className="eyebrow">Docs MVP</p>
          <h1>My documents</h1>
          <p className="muted">Signed in as {user.email}</p>
        </div>
        <form action={createDocument}>
          <button className="primaryButton" type="submit">
            New document
          </button>
        </form>
      </header>

      <section className="listCard">
        {documents.length === 0 ? (
          <p className="emptyText">No docs yet. Create your first document.</p>
        ) : (
          <ul className="docList">
            {documents.map((document) => (
              <li key={document.id}>
                <Link className="docLink" href={`/docs/${document.id}`}>
                  <span>{document.title}</span>
                  <time dateTime={document.updatedAt.toISOString()}>
                    {new Intl.DateTimeFormat("en", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(document.updatedAt)}
                  </time>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
