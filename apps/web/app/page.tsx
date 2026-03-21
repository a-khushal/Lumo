import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@repo/db";
import { signOutUser } from "../lib/auth";
import { requireCurrentUser } from "../lib/current-user";

export const dynamic = "force-dynamic";

const createDocument = async () => {
  "use server";

  const user = await requireCurrentUser();

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

const logout = async () => {
  "use server";

  await signOutUser("/sign-in");
};

export default async function Home() {
  const user = await requireCurrentUser();

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
    <main className="mx-auto w-full max-w-5xl px-5 pb-12 pt-10 sm:px-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-accent-strong">
            Docs MVP
          </p>
          <h1 className="mt-1 text-3xl font-semibold text-ink sm:text-4xl">
            My documents
          </h1>
          <p className="mt-1 text-sm text-muted">Signed in as {user.email}</p>
        </div>
        <div className="flex items-center gap-2">
          <form action={createDocument}>
            <button
              className="rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-strong"
              type="submit"
            >
              New document
            </button>
          </form>

          <form action={logout}>
            <button
              className="rounded-full border border-border bg-panel px-4 py-2.5 text-sm font-semibold text-ink transition hover:bg-slate-50"
              type="submit"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <section className="mt-5 overflow-hidden rounded-2xl border border-border bg-panel shadow-card">
        {documents.length === 0 ? (
          <p className="p-4 text-sm text-muted">
            No docs yet. Create your first document.
          </p>
        ) : (
          <ul>
            {documents.map((document) => (
              <li
                className="border-t border-border first:border-t-0"
                key={document.id}
              >
                <Link
                  className="flex flex-col gap-1 px-4 py-4 transition hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                  href={`/docs/${document.id}`}
                >
                  <span className="font-medium text-ink">{document.title}</span>
                  <time
                    className="text-sm text-muted"
                    dateTime={document.updatedAt.toISOString()}
                  >
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
