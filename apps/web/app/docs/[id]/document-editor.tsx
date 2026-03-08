"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type DocumentEditorProps = {
  documentId: string;
  initialTitle: string;
  initialText: string;
  updatedAt: string;
};

type SaveState = "saved" | "saving" | "error";

const formatUpdatedAt = (updatedAt: string) => {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(updatedAt));
};

export function DocumentEditor({
  documentId,
  initialTitle,
  initialText,
  updatedAt,
}: DocumentEditorProps) {
  const [title, setTitle] = useState(initialTitle);
  const [text, setText] = useState(initialText);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [lastSavedAt, setLastSavedAt] = useState(updatedAt);
  const lastPayloadRef = useRef(
    JSON.stringify({ title: initialTitle, content: { text: initialText } }),
  );

  const statusLabel = useMemo(() => {
    if (saveState === "saving") {
      return "Saving...";
    }

    if (saveState === "error") {
      return "Save failed";
    }

    return `Saved ${formatUpdatedAt(lastSavedAt)}`;
  }, [lastSavedAt, saveState]);

  useEffect(() => {
    const payload = JSON.stringify({
      title: title.trim() || "Untitled document",
      content: { text },
    });

    if (payload === lastPayloadRef.current) {
      return;
    }

    setSaveState("saving");

    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/docs/${documentId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: payload,
        });

        if (!response.ok) {
          throw new Error("Failed to save document");
        }

        const data = (await response.json()) as { updatedAt?: string };
        lastPayloadRef.current = payload;
        setSaveState("saved");

        if (data.updatedAt) {
          setLastSavedAt(data.updatedAt);
        }
      } catch {
        setSaveState("error");
      }
    }, 900);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [documentId, text, title]);

  return (
    <main className="editorPage">
      <header className="editorHeader">
        <div className="editorTitleWrap">
          <Link href="/" className="backLink">
            Back
          </Link>
          <input
            className="titleInput"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Untitled document"
          />
        </div>
        <p className="saveStatus">{statusLabel}</p>
      </header>

      <section className="editorCard">
        <textarea
          className="editorTextarea"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Start typing your document..."
        />
      </section>
    </main>
  );
}
