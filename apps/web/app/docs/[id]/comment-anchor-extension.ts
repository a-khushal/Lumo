import { Extension, type Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export type CommentAnchor = {
  id: string;
  from: number;
  to: number;
  isResolved: boolean;
};

type AnchorMeta = {
  anchors: CommentAnchor[];
  activeThreadId: string | null;
};

type AnchorState = {
  anchors: CommentAnchor[];
  activeThreadId: string | null;
  decorations: DecorationSet;
};

const commentAnchorPluginKey = new PluginKey<AnchorState>("comment-anchors");

const clamp = (value: number, min: number, max: number) => {
  return Math.min(Math.max(value, min), max);
};

const normalizeAnchor = (doc: ProseMirrorNode, anchor: CommentAnchor) => {
  const maxPosition = Math.max(doc.content.size, 1);
  const from = clamp(anchor.from, 1, maxPosition);
  const to = clamp(anchor.to, 1, maxPosition);

  if (to <= from) {
    return null;
  }

  return {
    ...anchor,
    from,
    to,
  };
};

const buildDecorations = (
  doc: ProseMirrorNode,
  anchors: CommentAnchor[],
  activeThreadId: string | null,
) => {
  const decorations = anchors
    .map((anchor) => normalizeAnchor(doc, anchor))
    .filter((value): value is CommentAnchor => value !== null)
    .map((anchor) => {
      const isActive = activeThreadId === anchor.id;
      const backgroundColor = anchor.isResolved
        ? "rgba(167, 243, 208, 0.32)"
        : "rgba(253, 230, 138, 0.42)";
      const outline = isActive
        ? "outline: 1px solid rgba(245, 158, 11, 0.95);"
        : "";

      return Decoration.inline(anchor.from, anchor.to, {
        style: `background-color: ${backgroundColor}; border-radius: 2px; ${outline}`,
        "data-comment-anchor-id": anchor.id,
      });
    });

  return DecorationSet.create(doc, decorations);
};

export const CommentAnchorExtension = Extension.create({
  name: "commentAnchors",
  addProseMirrorPlugins() {
    return [
      new Plugin<AnchorState>({
        key: commentAnchorPluginKey,
        state: {
          init: (_config, state) => {
            const anchors: CommentAnchor[] = [];

            return {
              anchors,
              activeThreadId: null,
              decorations: buildDecorations(state.doc, anchors, null),
            };
          },
          apply: (transaction, pluginState) => {
            const meta = transaction.getMeta(commentAnchorPluginKey) as
              | AnchorMeta
              | undefined;

            if (meta) {
              return {
                anchors: meta.anchors,
                activeThreadId: meta.activeThreadId,
                decorations: buildDecorations(
                  transaction.doc,
                  meta.anchors,
                  meta.activeThreadId,
                ),
              };
            }

            if (!transaction.docChanged) {
              return pluginState;
            }

            const mappedAnchors = pluginState.anchors.map((anchor) => {
              const from = transaction.mapping.map(anchor.from, -1);
              const to = transaction.mapping.map(anchor.to, 1);

              return {
                ...anchor,
                from,
                to,
              };
            });

            return {
              ...pluginState,
              anchors: mappedAnchors,
              decorations: buildDecorations(
                transaction.doc,
                mappedAnchors,
                pluginState.activeThreadId,
              ),
            };
          },
        },
        props: {
          decorations(state) {
            return commentAnchorPluginKey.getState(state)?.decorations ?? null;
          },
        },
      }),
    ];
  },
});

export const syncCommentAnchors = (
  editor: Editor | null,
  payload: AnchorMeta,
) => {
  if (!editor) {
    return;
  }

  editor.view.dispatch(
    editor.state.tr.setMeta(commentAnchorPluginKey, payload),
  );
};
