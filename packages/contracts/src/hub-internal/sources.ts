// HUB-FR-122 · PB-R05 · WRK-FR-27 · CR-060 · `POST /internal/jobs/:job_id/sources-resolved` (plan §3.3, §4). Runtime báo
// kết quả resolve từng nguồn; Bearer job-token (sai ⇒ 401, PB-R18). `source_id ∉ job.items` ⇒ 422 VALIDATION_ERROR (C12).
import { z } from "zod";
import { UuidSchema } from "../common";
import { SourcePinSchema } from "../hub-admin/sources";

export const RESOLVE_ERROR_CODES = [
  "SOURCE_UNRESOLVABLE",
  "SOURCE_TOO_LARGE",
  "SOURCE_HOST_NOT_ALLOWED",
  "SOURCE_FORBIDDEN_KIND",
] as const;

export const ResolveResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("ok"),
    source_id: UuidSchema,
    pin: SourcePinSchema,
    files: z.number().int().min(0),
    bytes: z.number().int().min(0),
  }),
  z.strictObject({
    status: z.literal("error"),
    source_id: UuidSchema,
    code: z.enum(RESOLVE_ERROR_CODES),
    message: z.string().max(500).optional(),
  }),
]);
export type ResolveResult = z.infer<typeof ResolveResultSchema>;

export const SourcesResolvedRequestSchema = z.strictObject({
  results: z.array(ResolveResultSchema).min(1).max(20),
});
export type SourcesResolvedRequest = z.infer<typeof SourcesResolvedRequestSchema>;
