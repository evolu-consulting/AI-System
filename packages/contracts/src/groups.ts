// ADM-FR-62, ADM-FR-55 · contract /admin/groups* (spec M3 §3 "Groups", M3-R01…R05, R23).
import { z } from "zod";
import {
  CATALOG_KEY_RE,
  CountSchema,
  EntityStatusSchema,
  IsoDateTime,
  ListQueryBase,
  LocalizedTextSchema,
  pageResponseSchema,
  RoleSchema,
  TenantKeySchema,
  UpdatedBySchema,
  USERNAME_RE,
  UuidSchema,
  VersionSchema,
} from "./common";

export const BETA_GROUP_KEY = "beta-testers";
export const GROUP_KEY_RE = CATALOG_KEY_RE;
export const GROUP_NAME_MAX = 64;
export const GROUP_DESC_MAX = 400;
export const GROUP_PASTE_MAX = 500;
export const USERNAME_INPUT_MAX = 64;
export const USER_GROUPS_MAX = 50;
export const OTHER_GROUPS_MAX = 3;

export const GroupKeySchema = z.string().trim().toLowerCase().regex(GROUP_KEY_RE);
export const GroupNameSchema = LocalizedTextSchema(GROUP_NAME_MAX);
/** Trim ≤ 400; `""` → `null` (một bản, không theo ngôn ngữ, M3-R01). */
export const GroupDescriptionSchema = z
  .string()
  .trim()
  .max(GROUP_DESC_MAX)
  .transform((v) => (v === "" ? null : v));

const Username = z.string().regex(USERNAME_RE);

/** Trường của GroupRef — dùng lại khi ghép thêm trường (ma trận, "Ai dùng được"); luôn bọc `refineBeta`. */
export const groupRefShape = {
  id: UuidSchema,
  key: z.string().regex(GROUP_KEY_RE),
  name: GroupNameSchema,
  is_beta: z.boolean(),
};

/** `is_beta ⇔ key = "beta-testers"`. */
export function refineBeta<T extends z.ZodType<{ key: string; is_beta: boolean }>>(schema: T) {
  return schema.refine((g) => g.is_beta === (g.key === BETA_GROUP_KEY), {
    message: "is_beta must equal key === 'beta-testers'",
    path: ["is_beta"],
  });
}

export const GroupRefSchema = refineBeta(z.strictObject(groupRefShape));
export type GroupRef = z.infer<typeof GroupRefSchema>;

const listItemShape = {
  id: UuidSchema,
  tenant_id: UuidSchema,
  tenant_key: TenantKeySchema,
  tenant_name: z.string().min(1),
  key: z.string().regex(GROUP_KEY_RE),
  name: GroupNameSchema,
  description: z.string().max(GROUP_DESC_MAX).nullable(),
  is_beta: z.boolean(),
  member_count: CountSchema,
  /** Số grant (feature) của group. */
  feature_count: CountSchema,
  /** Luôn 0 tới M5 (FR-37). */
  agent_count: CountSchema,
  version: VersionSchema,
  updated_at: IsoDateTime,
  updated_by: UpdatedBySchema,
};
export const GroupListItemSchema = refineBeta(z.strictObject(listItemShape));
export type GroupListItem = z.infer<typeof GroupListItemSchema>;

export const GroupSchema = refineBeta(
  z.strictObject({ ...listItemShape, created_at: IsoDateTime }),
);
export type Group = z.infer<typeof GroupSchema>;

export const GroupCreateRequestSchema = z.strictObject({
  key: GroupKeySchema,
  name: GroupNameSchema,
  description: GroupDescriptionSchema.nullable().default(null),
});
export type GroupCreateRequest = z.infer<typeof GroupCreateRequestSchema>;

/** Không có `key` (bất biến, M3-R01) → gửi lên là 400. */
export const GroupUpdateRequestSchema = z.strictObject({
  version: VersionSchema,
  name: GroupNameSchema.optional(),
  description: GroupDescriptionSchema.nullable().optional(),
});
export type GroupUpdateRequest = z.infer<typeof GroupUpdateRequestSchema>;

/** `q` khớp key, name.vi, name.en; `tenant_id` chỉ có tác dụng với platform_admin. */
export const GroupListQuerySchema = ListQueryBase.extend({ tenant_id: UuidSchema.optional() });
export type GroupListQuery = z.infer<typeof GroupListQuerySchema>;

/** Sắp tenant_key, `beta-testers` đầu, rồi key. Không có `counts` (không chip). */
export const GroupListResponseSchema = pageResponseSchema(GroupListItemSchema);
export type GroupListResponse = z.infer<typeof GroupListResponseSchema>;

export const GroupMemberSchema = z.strictObject({
  user_id: UuidSchema,
  username: Username,
  display_name: z.string().min(1),
  role: RoleSchema,
  status: EntityStatusSchema,
  locked_by_tenant: z.boolean(),
  last_login_at: IsoDateTime.nullable(),
  added_at: IsoDateTime,
  added_by: UpdatedBySchema,
  /** Group khác của user (≤ 3, beta đầu rồi key, không gồm group đang xem). */
  other_groups: z.array(GroupRefSchema).max(OTHER_GROUPS_MAX),
  other_groups_total: CountSchema,
});
export type GroupMember = z.infer<typeof GroupMemberSchema>;

/** `q` khớp username/display_name; sắp username. */
export const GroupMemberListQuerySchema = ListQueryBase;
export type GroupMemberListQuery = z.infer<typeof GroupMemberListQuerySchema>;
export const GroupMemberListResponseSchema = pageResponseSchema(GroupMemberSchema);
export type GroupMemberListResponse = z.infer<typeof GroupMemberListResponseSchema>;

/** Bỏ trùng giữ lần xuất hiện đầu. */
const dedupe = (xs: string[]): string[] => [...new Set(xs)];

/**
 * 1–500 phần tử **trước** khi bỏ trùng (test-plan G8); mỗi phần tử trim → lower, 1–64 ký tự. Không kiểm USERNAME_RE ở
 * đây: sai định dạng → `not_found` (không 400, M3-R03). `dry_run` → không ghi, không NOTIFY.
 */
export const GroupMembersAddRequestSchema = z.strictObject({
  usernames: z
    .array(z.string().trim().toLowerCase().min(1).max(USERNAME_INPUT_MAX))
    .min(1)
    .max(GROUP_PASTE_MAX)
    .transform(dedupe),
  dry_run: z.boolean().default(false),
});
export type GroupMembersAddRequest = z.infer<typeof GroupMembersAddRequestSchema>;

/** Username đã chuẩn hoá, theo thứ tự gửi lên; không all-or-nothing. */
export const GroupMembersAddResponseSchema = z.strictObject({
  added: z.array(z.string()),
  not_found: z.array(z.string()),
  already: z.array(z.string()),
});
export type GroupMembersAddResponse = z.infer<typeof GroupMembersAddResponseSchema>;

/** Ô dán (FE) và server cùng luật: tách `/[\s,]+/`, trim, chữ thường, bỏ rỗng, bỏ trùng giữ thứ tự. Không cắt 500. */
export function parseUsernameList(text: string): string[] {
  return dedupe(
    text
      .split(/[\s,]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0),
  );
}
