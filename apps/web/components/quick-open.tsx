"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type QuickOpenResult = {
  id: string;
  title: string;
  updatedAt: string;
  owner: {
    id: string;
    name: string | null;
    email: string;
  };
  visibility: "owned" | "shared";
  role?: "OWNER" | "EDITOR" | "COMMENTER" | "VIEWER";
};

type QuickOpenResponse = {
  documents: QuickOpenResult[];
};

type QuickOpenProps = {
  currentDocumentId?: string;
};

const parseApiError = async (response: Response) => {
  try {
    const data = (await response.json()) as { error?: string };
    return data.error ?? "Request failed";
  } catch {
    return "Request failed";
  }
};

const formatTime = (value: string) => {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
};

export function QuickOpen({ currentDocumentId }: QuickOpenProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isReady, setIsReady] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<QuickOpenResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestIdRef = useRef(0);

  const closePalette = useCallback(() => {
    setIsOpen(false);
    setErrorMessage(null);
  }, []);

  const fetchResults = useCallback(async (nextQuery: string) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const params = new URLSearchParams();

      if (nextQuery.trim()) {
        params.set("q", nextQuery.trim());
      }

      const response = await fetch(`/api/docs/quick-open?${params.toString()}`);

      if (!response.ok) {
        throw new Error(await parseApiError(response));
      }

      const data = (await response.json()) as QuickOpenResponse;

      if (requestIdRef.current === requestId) {
        setResults(data.documents);
      }
    } catch (error) {
      if (requestIdRef.current === requestId) {
        setErrorMessage(
          error instanceof Error ? error.message : "Failed to search documents",
        );
      }
    } finally {
      if (requestIdRef.current === requestId) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void fetchResults(query);
    }, 160);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [fetchResults, isOpen, query]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    inputRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    setIsReady(true);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isShortcut =
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k" &&
        !event.shiftKey;

      if (isShortcut) {
        event.preventDefault();
        setIsOpen(true);
        return;
      }

      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  const hasNoResults = useMemo(() => {
    return !isLoading && !errorMessage && results.length === 0;
  }, [errorMessage, isLoading, results.length]);

  const openPalette = () => {
    setIsOpen(true);
  };

  const navigateToDocument = (documentId: string) => {
    closePalette();

    if (documentId === currentDocumentId) {
      return;
    }

    router.push(`/docs/${documentId}`);
  };

  if (!isReady) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        onClick={openPalette}
        className="fixed bottom-4 right-4 z-20 inline-flex items-center gap-2 rounded-full border border-border bg-panel px-3 py-2 text-xs font-semibold text-ink shadow-card transition hover:bg-slate-50"
      >
        Quick open
        <span className="rounded border border-border bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-muted">
          Ctrl K
        </span>
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-30 flex items-start justify-center bg-black/35 px-4 pt-[14vh]">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Quick open"
            className="w-full max-w-2xl rounded-2xl border border-border bg-panel shadow-card"
          >
            <div className="border-b border-border p-3">
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search documents"
                className="w-full rounded-lg border border-border bg-panel px-3 py-2 text-sm text-ink outline-none ring-accent/40 focus:ring-2"
              />
              <p className="mt-1 text-xs text-muted">
                Jump to any owned or shared document.
              </p>
            </div>

            <div className="max-h-[50vh] overflow-y-auto p-2">
              {isLoading ? (
                <p className="px-2 py-3 text-sm text-muted">Searching...</p>
              ) : null}

              {errorMessage ? (
                <p className="px-2 py-3 text-sm font-medium text-rose-700">
                  {errorMessage}
                </p>
              ) : null}

              {results.map((document) => {
                const ownerName =
                  document.owner.name?.trim() || document.owner.email;

                return (
                  <button
                    key={document.id}
                    type="button"
                    onClick={() => navigateToDocument(document.id)}
                    className={`mb-1 w-full rounded-lg border px-3 py-2 text-left transition last:mb-0 ${
                      document.id === currentDocumentId
                        ? "border-emerald-200 bg-emerald-50"
                        : "border-border bg-panel hover:bg-slate-50"
                    }`}
                  >
                    <p className="font-medium text-ink">{document.title}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {document.visibility === "owned"
                        ? "Owned by you"
                        : `Shared by ${ownerName} (${document.role ?? "VIEWER"})`}
                      {" · "}
                      Updated {formatTime(document.updatedAt)}
                    </p>
                  </button>
                );
              })}

              {hasNoResults ? (
                <p className="px-2 py-3 text-sm text-muted">
                  No documents found.
                </p>
              ) : null}
            </div>

            <div className="border-t border-border p-2 text-right">
              <button
                type="button"
                onClick={closePalette}
                className="rounded-lg border border-border bg-panel px-3 py-1.5 text-sm font-medium text-ink transition hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
