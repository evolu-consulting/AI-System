// CR-105 · chỗ stage trỏ Group: id (def tenant) HOẶC mã `admin.groups.key` (def thư viện có `slot`) — đúng một trong hai. Luật
// "thư viện chỉ mã / tenant chỉ id" ở server (`def-group-keys.rules`). Export lại qua `processes.ts`.
import { z } from "zod";
import { ESCALATE_AFTER_H } from "../chat/processes";
import { CATALOG_KEY_RE, UuidSchema } from "../common";

/** Mã Group (`admin.groups.key`). */
export const StageGroupKeySchema = z.string().regex(CATALOG_KEY_RE);
const oneGroupRef = (g: { group_id?: unknown; group_key?: unknown }) =>
  (g.group_id === undefined) !== (g.group_key === undefined);
const ONE = { message: "group_id xor group_key" };

export const StageEscalateSchema = z
  .strictObject({
    after_h: z.number().int().min(ESCALATE_AFTER_H.min).max(ESCALATE_AFTER_H.max),
    group_id: UuidSchema.optional(),
    group_key: StageGroupKeySchema.optional(),
  })
  .refine(oneGroupRef, ONE);
export type StageEscalate = z.infer<typeof StageEscalateSchema>;

/** `answerer` loại Group. */
export const AnswererGroupSchema = z
  .strictObject({
    kind: z.literal("group"),
    group_id: UuidSchema.optional(),
    group_key: StageGroupKeySchema.optional(),
  })
  .refine(oneGroupRef, ONE);
