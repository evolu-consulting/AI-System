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

/** CR-182 · R1 · vai của bước Duyệt/Ký: khoá slug + nhãn nghiệp vụ; quản trị công ty giao nhóm/người cho vai (`hub.process_role_assignments`). */
export const ROLE_KEY_MAX = 40;
export const ROLE_LABEL_MAX = 80;
export const ROLE_KEY_RE = /^[a-z0-9][a-z0-9-]*$/;
export const RoleKeySchema = z.string().min(1).max(ROLE_KEY_MAX).regex(ROLE_KEY_RE);
export const StageRoleSchema = z.strictObject({
  key: RoleKeySchema,
  label: z.string().trim().min(1).max(ROLE_LABEL_MAX),
});
export type StageRole = z.infer<typeof StageRoleSchema>;

/** CR-127 · E1 · quá hạn chuyển cho một PHÒNG (`group_id` xor `group_key`) HOẶC một NGƯỜI (`user_id`, assignee `via='escalated'`) — đúng một. */
const oneEscalateTarget = (e: {
  group_id?: unknown;
  group_key?: unknown;
  user_id?: unknown;
  role?: unknown;
}) => {
  const n = [e.group_id, e.group_key, e.user_id].filter((v) => v !== undefined).length;
  return e.role === undefined ? n === 1 : n <= 1; // CR-182 · có vai ⇒ đích có thể chưa giao (giải lúc chạy)
};
export const StageEscalateSchema = z
  .strictObject({
    after_h: z.number().int().min(ESCALATE_AFTER_H.min).max(ESCALATE_AFTER_H.max),
    group_id: UuidSchema.optional(),
    group_key: StageGroupKeySchema.optional(),
    user_id: UuidSchema.optional(),
    role: StageRoleSchema.optional(), // CR-182 · vai thay cho nhóm/người cố định (giải lúc chạy)
  })
  .refine(oneEscalateTarget, { message: "group_id xor group_key xor user_id" });
export type StageEscalate = z.infer<typeof StageEscalateSchema>;

/** `answerer` loại Group. */
export const AnswererGroupSchema = z
  .strictObject({
    kind: z.literal("group"),
    group_id: UuidSchema.optional(),
    group_key: StageGroupKeySchema.optional(),
  })
  .refine(oneGroupRef, ONE);
