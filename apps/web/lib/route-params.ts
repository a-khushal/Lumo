import { z } from "zod";

const cuidParamSchema = z.string().cuid();

export const docIdParamsSchema = z.object({
  id: cuidParamSchema,
});

export const docCommentParamsSchema = z.object({
  id: cuidParamSchema,
  commentId: cuidParamSchema,
});

export const docMemberParamsSchema = z.object({
  id: cuidParamSchema,
  memberId: cuidParamSchema,
});

export const docSuggestionParamsSchema = z.object({
  id: cuidParamSchema,
  suggestionId: cuidParamSchema,
});

export const docSnapshotParamsSchema = z.object({
  id: cuidParamSchema,
  snapshotId: cuidParamSchema,
});
