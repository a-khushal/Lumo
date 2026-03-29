import Link from "next/link";
import { redirect } from "next/navigation";
import { db, Prisma } from "@repo/db";
import { signOutUser } from "../lib/auth";
import { requireCurrentUser } from "../lib/current-user";

export const dynamic = "force-dynamic";

type HomePageProps = {
  searchParams: Promise<{ scope?: string }>;
};

type Scope =
  | { type: "all" }
  | { type: "unfiled" }
  | { type: "folder"; folderId: string }
  | { type: "trash" };

const toScopeQuery = (scope: string | null | undefined) => {
  if (!scope || scope === "all") {
    return "/";
  }

  return `/?scope=${encodeURIComponent(scope)}`;
};

const sanitizeScopeValue = (value: unknown) => {
  if (typeof value !== "string") {
    return "all";
  }

  const trimmed = value.trim();
  return trimmed || "all";
};

const resolveScope = (scopeValue: string, folderIds: Set<string>): Scope => {
  if (scopeValue === "trash") {
    return { type: "trash" };
  }

  if (scopeValue === "unfiled") {
    return { type: "unfiled" };
  }

  if (scopeValue.startsWith("folder:")) {
    const folderId = scopeValue.slice("folder:".length);

    if (folderIds.has(folderId)) {
      return { type: "folder", folderId };
    }
  }

  return { type: "all" };
};

const formatTimestamp = (value: Date) => {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
};

const normalizeFolderName = (value: unknown) => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().replace(/\s+/g, " ");

  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, 64);
};

const normalizeFolderId = (value: unknown) => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const createDocument = async (formData: FormData) => {
  "use server";

  const user = await requireCurrentUser();
  const requestedFolderId = normalizeFolderId(formData.get("folderId"));
  let folderId: string | null = null;

  if (requestedFolderId) {
    const folder = await db.documentFolder.findFirst({
      where: {
        id: requestedFolderId,
        ownerId: user.id,
      },
      select: {
        id: true,
      },
    });

    if (!folder) {
      redirect("/?scope=all");
    }

    folderId = folder.id;
  }

  const document = await db.document.create({
    data: {
      ownerId: user.id,
      folderId,
      title: "Untitled document",
      content: {
        type: "doc",
        content: [{ type: "paragraph" }],
      } satisfies Prisma.InputJsonValue,
    },
    select: {
      id: true,
    },
  });

  redirect(`/docs/${document.id}`);
};

const createFolder = async (formData: FormData) => {
  "use server";

  const user = await requireCurrentUser();
  const folderName = normalizeFolderName(formData.get("name"));

  if (!folderName) {
    redirect("/");
  }

  try {
    const folder = await db.documentFolder.create({
      data: {
        ownerId: user.id,
        name: folderName,
      },
      select: {
        id: true,
      },
    });

    redirect(`/?scope=folder:${folder.id}`);
  } catch {
    redirect("/");
  }
};

const moveDocument = async (formData: FormData) => {
  "use server";

  const user = await requireCurrentUser();
  const documentId = normalizeFolderId(formData.get("documentId"));
  const folderId = normalizeFolderId(formData.get("folderId"));
  const scope = sanitizeScopeValue(formData.get("scope"));

  if (!documentId) {
    redirect(toScopeQuery(scope));
  }

  const document = await db.document.findFirst({
    where: {
      id: documentId,
      ownerId: user.id,
      isArchived: false,
    },
    select: {
      id: true,
    },
  });

  if (!document) {
    redirect(toScopeQuery(scope));
  }

  let nextFolderId: string | null = null;

  if (folderId) {
    const folder = await db.documentFolder.findFirst({
      where: {
        id: folderId,
        ownerId: user.id,
      },
      select: {
        id: true,
      },
    });

    if (!folder) {
      redirect(toScopeQuery(scope));
    }

    nextFolderId = folder.id;
  }

  await db.document.update({
    where: {
      id: document.id,
    },
    data: {
      folderId: nextFolderId,
    },
  });

  redirect(toScopeQuery(scope));
};

const archiveDocument = async (formData: FormData) => {
  "use server";

  const user = await requireCurrentUser();
  const documentId = normalizeFolderId(formData.get("documentId"));
  const scope = sanitizeScopeValue(formData.get("scope"));

  if (!documentId) {
    redirect(toScopeQuery(scope));
  }

  await db.document.updateMany({
    where: {
      id: documentId,
      ownerId: user.id,
      isArchived: false,
    },
    data: {
      isArchived: true,
      archivedAt: new Date(),
    },
  });

  redirect(toScopeQuery(scope));
};

const restoreDocument = async (formData: FormData) => {
  "use server";

  const user = await requireCurrentUser();
  const documentId = normalizeFolderId(formData.get("documentId"));
  const scope = sanitizeScopeValue(formData.get("scope"));

  if (!documentId) {
    redirect(toScopeQuery(scope));
  }

  await db.document.updateMany({
    where: {
      id: documentId,
      ownerId: user.id,
      isArchived: true,
    },
    data: {
      isArchived: false,
      archivedAt: null,
    },
  });

  redirect(toScopeQuery(scope));
};

const logout = async () => {
  "use server";

  await signOutUser("/sign-in");
};

export default async function Home({ searchParams }: HomePageProps) {
  const user = await requireCurrentUser();
  const folders = await db.documentFolder.findMany({
    where: {
      ownerId: user.id,
    },
    select: {
      id: true,
      name: true,
      updatedAt: true,
    },
    orderBy: [{ name: "asc" }, { updatedAt: "desc" }],
  });

  const params = await searchParams;
  const scopeValue = sanitizeScopeValue(params.scope);
  const folderIds = new Set(folders.map((folder) => folder.id));
  const scope = resolveScope(scopeValue, folderIds);

  const documents = await db.document.findMany({
    where: {
      ownerId: user.id,
      ...(scope.type === "trash"
        ? { isArchived: true }
        : {
            isArchived: false,
            ...(scope.type === "unfiled" ? { folderId: null } : {}),
            ...(scope.type === "folder" ? { folderId: scope.folderId } : {}),
          }),
    },
    select: {
      id: true,
      title: true,
      folderId: true,
      isArchived: true,
      archivedAt: true,
      updatedAt: true,
      folder: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy:
      scope.type === "trash"
        ? [{ archivedAt: "desc" }, { updatedAt: "desc" }]
        : [{ updatedAt: "desc" }],
  });

  const activeCount = await db.document.count({
    where: {
      ownerId: user.id,
      isArchived: false,
    },
  });

  const unfiledCount = await db.document.count({
    where: {
      ownerId: user.id,
      isArchived: false,
      folderId: null,
    },
  });

  const trashCount = await db.document.count({
    where: {
      ownerId: user.id,
      isArchived: true,
    },
  });

  const readStates = await db.documentCommentRead.findMany({
    where: {
      userId: user.id,
      documentId: {
        in: documents.map((document) => document.id),
      },
    },
    select: {
      documentId: true,
      lastReadAt: true,
    },
  });

  const readMap = new Map(
    readStates.map((state) => [state.documentId, state.lastReadAt]),
  );

  const documentsWithUnread = await Promise.all(
    documents.map(async (document) => {
      if (document.isArchived) {
        return {
          ...document,
          unreadCount: 0,
        };
      }

      const unreadCount = await db.documentComment.count({
        where: {
          documentId: document.id,
          authorId: {
            not: user.id,
          },
          createdAt: {
            gt: readMap.get(document.id) ?? new Date(0),
          },
        },
      });

      return {
        ...document,
        unreadCount,
      };
    }),
  );

  const currentFolderId = scope.type === "folder" ? scope.folderId : null;
  const currentFolder =
    scope.type === "folder"
      ? (folders.find((folder) => folder.id === scope.folderId) ?? null)
      : null;

  const defaultFolderIdForCreate = currentFolderId ?? "";

  return (
    <main className="mx-auto w-full max-w-6xl px-5 pb-12 pt-10 sm:px-8">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
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
            <input
              type="hidden"
              name="folderId"
              value={defaultFolderIdForCreate}
            />
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

      <div className="grid gap-5 lg:grid-cols-[250px,1fr]">
        <aside className="space-y-4 rounded-2xl border border-border bg-panel p-4 shadow-card">
          <nav className="space-y-1">
            <Link
              href="/"
              className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition ${
                scope.type === "all"
                  ? "bg-accent text-white"
                  : "text-ink hover:bg-slate-50"
              }`}
            >
              <span>All documents</span>
              <span className="text-xs">{activeCount}</span>
            </Link>

            <Link
              href="/?scope=unfiled"
              className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition ${
                scope.type === "unfiled"
                  ? "bg-accent text-white"
                  : "text-ink hover:bg-slate-50"
              }`}
            >
              <span>Unfiled</span>
              <span className="text-xs">{unfiledCount}</span>
            </Link>

            {folders.map((folder) => {
              const isActive = currentFolderId === folder.id;

              return (
                <Link
                  key={folder.id}
                  href={`/?scope=folder:${folder.id}`}
                  className={`block rounded-lg px-3 py-2 text-sm font-medium transition ${
                    isActive
                      ? "bg-accent text-white"
                      : "text-ink hover:bg-slate-50"
                  }`}
                >
                  {folder.name}
                </Link>
              );
            })}

            <Link
              href="/?scope=trash"
              className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition ${
                scope.type === "trash"
                  ? "bg-rose-600 text-white"
                  : "text-ink hover:bg-slate-50"
              }`}
            >
              <span>Trash</span>
              <span className="text-xs">{trashCount}</span>
            </Link>
          </nav>

          <div className="border-t border-border pt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted">
              New folder
            </p>
            <form action={createFolder} className="flex gap-2">
              <input
                className="w-full rounded-lg border border-border bg-panel px-3 py-2 text-sm text-ink outline-none ring-accent/40 focus:ring-2"
                name="name"
                placeholder="Folder name"
                maxLength={64}
                required
              />
              <button
                className="rounded-lg border border-border bg-panel px-3 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50"
                type="submit"
              >
                Add
              </button>
            </form>
          </div>
        </aside>

        <section className="overflow-hidden rounded-2xl border border-border bg-panel shadow-card">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-base font-semibold text-ink">
              {scope.type === "trash"
                ? "Trash"
                : scope.type === "unfiled"
                  ? "Unfiled documents"
                  : scope.type === "folder"
                    ? `Folder: ${currentFolder?.name ?? "Documents"}`
                    : "All documents"}
            </h2>
            <p className="text-sm text-muted">
              {scope.type === "trash"
                ? "Restore docs when you need them again."
                : "Open, organize, and keep your workspace tidy."}
            </p>
          </div>

          {documentsWithUnread.length === 0 ? (
            <p className="p-4 text-sm text-muted">
              {scope.type === "trash"
                ? "Trash is empty."
                : "No docs in this view yet."}
            </p>
          ) : (
            <ul>
              {documentsWithUnread.map((document) => (
                <li
                  className="border-t border-border px-4 py-3 first:border-t-0"
                  key={document.id}
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      {document.isArchived ? (
                        <p className="truncate font-medium text-ink">
                          {document.title}
                        </p>
                      ) : (
                        <Link
                          href={`/docs/${document.id}`}
                          className="truncate font-medium text-ink hover:text-accent-strong"
                        >
                          {document.title}
                        </Link>
                      )}

                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                        {document.folder ? (
                          <span className="rounded-full border border-border bg-slate-50 px-2 py-0.5">
                            {document.folder.name}
                          </span>
                        ) : (
                          <span className="rounded-full border border-border bg-slate-50 px-2 py-0.5">
                            Unfiled
                          </span>
                        )}

                        {document.unreadCount > 0 ? (
                          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-semibold text-amber-700">
                            {document.unreadCount} unread
                          </span>
                        ) : null}

                        <time dateTime={document.updatedAt.toISOString()}>
                          Updated {formatTimestamp(document.updatedAt)}
                        </time>

                        {document.archivedAt ? (
                          <time dateTime={document.archivedAt.toISOString()}>
                            Archived {formatTimestamp(document.archivedAt)}
                          </time>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {!document.isArchived ? (
                        <form
                          action={moveDocument}
                          className="flex items-center gap-2"
                        >
                          <input
                            type="hidden"
                            name="documentId"
                            value={document.id}
                          />
                          <input
                            type="hidden"
                            name="scope"
                            value={scopeValue}
                          />
                          <select
                            name="folderId"
                            defaultValue={document.folderId ?? ""}
                            className="rounded-lg border border-border bg-panel px-2 py-1.5 text-sm text-ink"
                          >
                            <option value="">Unfiled</option>
                            {folders.map((folder) => (
                              <option key={folder.id} value={folder.id}>
                                {folder.name}
                              </option>
                            ))}
                          </select>
                          <button
                            className="rounded-lg border border-border bg-panel px-3 py-1.5 text-sm font-medium text-ink transition hover:bg-slate-50"
                            type="submit"
                          >
                            Move
                          </button>
                        </form>
                      ) : null}

                      {!document.isArchived ? (
                        <form action={archiveDocument}>
                          <input
                            type="hidden"
                            name="documentId"
                            value={document.id}
                          />
                          <input
                            type="hidden"
                            name="scope"
                            value={scopeValue}
                          />
                          <button
                            className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-sm font-medium text-rose-700 transition hover:bg-rose-100"
                            type="submit"
                          >
                            Archive
                          </button>
                        </form>
                      ) : (
                        <form action={restoreDocument}>
                          <input
                            type="hidden"
                            name="documentId"
                            value={document.id}
                          />
                          <input
                            type="hidden"
                            name="scope"
                            value={scopeValue}
                          />
                          <button
                            className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-accent-strong transition hover:bg-emerald-100"
                            type="submit"
                          >
                            Restore
                          </button>
                        </form>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
