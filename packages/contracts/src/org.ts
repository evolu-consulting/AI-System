// M1D-FR-02 · M1D-FR-03 · docs/specs/M1-departments: cơ cấu tổ chức của tenant (quản lý trực tiếp + phòng ban) — admin-api
// `/admin/org*`, màn Cài đặt › Phòng ban của contracts-web. Phòng ban = Group (`/admin/groups`) + trưởng phòng.
import { z } from "zod";
import { ListQueryBase, UuidSchema as Uuid } from "./common";

export const ORG_MEMBERS_MAX = 2000;

export const OrgQuerySchema = z.object({ tenant_id: Uuid.optional() });
export type OrgQuery = z.infer<typeof OrgQuerySchema>;

export const OrgMemberSchema = z.object({
  user_id: Uuid,
  username: z.string(),
  display_name: z.string(),
  manager_id: Uuid.nullable(),
  /** CR-147b: chức vụ (null = chưa nhập). */
  job_title: z.string().nullable().optional(),
});
export type OrgMember = z.infer<typeof OrgMemberSchema>;

export const OrgDepartmentSchema = z.object({
  group_id: Uuid,
  key: z.string(),
  name: z.string(),
  head_user_id: Uuid.nullable(),
  /** CR-139d · phòng cha (null = trực thuộc công ty). */
  parent_group_id: Uuid.nullable(),
  member_ids: z.array(Uuid),
});
export type OrgDepartment = z.infer<typeof OrgDepartmentSchema>;

/** CR-151 · `GET /admin/org/members?q&limit&offset` — trang thành viên (tìm tên/tên đăng nhập ở máy chủ; limit ≤ 200, mặc định 50). */
export const OrgMembersQuerySchema = ListQueryBase.extend({ tenant_id: Uuid.optional() });
export type OrgMembersQuery = z.infer<typeof OrgMembersQuerySchema>;
export const OrgMemberRowSchema = OrgMemberSchema.extend({ manager_name: z.string().nullable() });
export type OrgMemberRow = z.infer<typeof OrgMemberRowSchema>;
export const OrgMembersResponseSchema = z.strictObject({
  items: z.array(OrgMemberRowSchema),
  total: z.number().int().min(0),
});
export type OrgMembersResponse = z.infer<typeof OrgMembersResponseSchema>;

export const OrgResponseSchema = z.object({
  members: z.array(OrgMemberSchema),
  departments: z.array(OrgDepartmentSchema),
});
export type OrgResponse = z.infer<typeof OrgResponseSchema>;

/** `PUT /admin/org/managers/:user_id` — null = bỏ quản lý. Vòng ⇒ 400 VALIDATION_ERROR `details.reason = "manager_cycle"`. */
export const ManagerSetRequestSchema = z.strictObject({ manager_id: Uuid.nullable() });
export type ManagerSetRequest = z.infer<typeof ManagerSetRequestSchema>;

/**
 * `PUT /admin/org/departments/:group_id` — đánh dấu Group là phòng ban + trưởng phòng (null = chưa có).
 * CR-139d · `parent_group_id`: bỏ qua = giữ nguyên; null = lên gốc; id = phòng cha (phải là phòng ban cùng công ty, không tạo vòng ⇒ 400 `dept_cycle`).
 */
export const DepartmentSetRequestSchema = z.strictObject({
  head_user_id: Uuid.nullable(),
  parent_group_id: Uuid.nullable().optional(),
});
export type DepartmentSetRequest = z.infer<typeof DepartmentSetRequestSchema>;

/** CR-147b ý 9 · `PUT /admin/org/members/:user_id/title` — chức vụ nhân viên (null/rỗng = xoá). Hiện ở hồ sơ cá nhân + thẻ người (`/people`). */
export const JobTitleSetRequestSchema = z.strictObject({
  job_title: z
    .string()
    .trim()
    .max(80)
    .nullable()
    .transform((v) => (v ? v : null)),
});
export type JobTitleSetRequest = z.infer<typeof JobTitleSetRequestSchema>;

// ---- CR-189 · BR-189-6: sửa cơ cấu trực tiếp trên sơ đồ (Admin). Phòng ban = Group + hàng `departments`. ----
export const DEPT_NAME_MAX = 64;
export const DEPT_MEMBERS_BATCH_MAX = 50;

/** Tên phòng: bỏ khoảng trắng đầu/cuối, gộp khoảng trắng liền nhau; không trùng (không phân hoa/thường) trong cùng một phòng cha ⇒ 409 `NAME_TAKEN`. */
const DeptNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(DEPT_NAME_MAX)
  .transform((s) => s.replace(/\s+/g, " "));

/** Mã lỗi riêng của sửa cơ cấu (khối riêng, không thuộc `API_ERRORS` khoá 46). Dùng kèm `NOT_FOUND`/`NAME_TAKEN`/`VALIDATION_ERROR`/`EXTERNAL_USER_NOT_ALLOWED`. */
export const ORG_DEPT_ERRORS = {
  /** Xoá phòng còn người hoặc còn phòng con. `details = { members, children }` (đếm). */
  DEPT_NOT_EMPTY: 409,
  /** Người là trưởng phòng: thêm vào phòng khác / bỏ khỏi chính phòng mình phải đổi trưởng phòng trước. `details = { user_ids, group_ids }`. */
  MEMBER_IS_HEAD: 409,
} as const satisfies Record<string, 409>;
export type OrgDeptErrorCode = keyof typeof ORG_DEPT_ERRORS;

/** `POST /admin/org/departments` — tạo phòng (Group + đánh dấu phòng ban) trong MỘT lời gọi; `parent_group_id` vắng/null = trực thuộc công ty. */
export const DeptCreateRequestSchema = z.strictObject({
  name: DeptNameSchema,
  parent_group_id: Uuid.nullable().optional(),
  head_user_id: Uuid.nullable().optional(),
});
export type DeptCreateRequest = z.infer<typeof DeptCreateRequestSchema>;
export const DeptCreateResponseSchema = z.strictObject({
  group_id: Uuid,
  key: z.string(),
  name: z.string(),
  parent_group_id: Uuid.nullable(),
  head_user_id: Uuid.nullable(),
});
export type DeptCreateResponse = z.infer<typeof DeptCreateResponseSchema>;

/** `PUT /admin/org/departments/:id/name` — đổi tên; trả tên cũ để Hoàn tác = gọi lại với tên cũ. */
export const DeptRenameRequestSchema = z.strictObject({ name: DeptNameSchema });
export type DeptRenameRequest = z.infer<typeof DeptRenameRequestSchema>;
export const DeptRenameResponseSchema = z.strictObject({
  group_id: Uuid,
  name: z.string(),
  before: z.string(),
});
export type DeptRenameResponse = z.infer<typeof DeptRenameResponseSchema>;

/**
 * Quyền theo nhóm đổi khi chuyển người: số cặp (người, tính năng) mất / được thêm do `feature_grants` của các nhóm
 * (phòng) rời đi / đến. Cấp trực tiếp cho người không đổi. 0/0 = không đổi quyền.
 */
export const OrgAccessChangeSchema = z.strictObject({
  gained: z.number().int().min(0),
  lost: z.number().int().min(0),
});
export type OrgAccessChange = z.infer<typeof OrgAccessChangeSchema>;

/** `POST /admin/org/departments/:id/members` — thêm (mỗi người một phòng: người đang ở phòng khác ⇒ CHUYỂN sang đây). Cả lô hoặc không gì cả. */
export const DeptMembersAddRequestSchema = z.strictObject({
  user_ids: z.array(Uuid).min(1).max(DEPT_MEMBERS_BATCH_MAX),
});
export type DeptMembersAddRequest = z.infer<typeof DeptMembersAddRequestSchema>;
export const DeptMembersAddResponseSchema = z.strictObject({
  group_id: Uuid,
  /** Người mới vào phòng này (kể cả người được chuyển tới). */
  added: z.array(Uuid),
  /** Đã ở phòng này từ trước (không đổi gì). */
  already: z.array(Uuid),
  /** Người bị chuyển khỏi phòng khác: `from_group_ids` = các phòng đã rời (Hoàn tác = thêm lại vào phòng đó). */
  moved: z.array(z.strictObject({ user_id: Uuid, from_group_ids: z.array(Uuid) })),
  access: OrgAccessChangeSchema,
});
export type DeptMembersAddResponse = z.infer<typeof DeptMembersAddResponseSchema>;

/** `DELETE /admin/org/departments/:id/members/:user_id` — bỏ khỏi phòng ⇒ về phòng cha (phòng cấp trên cùng ⇒ về công ty, `moved_to_group_id = null`). */
export const DeptMemberRemoveResponseSchema = z.strictObject({
  group_id: Uuid,
  user_id: Uuid,
  /** false = vốn không ở phòng này (không đổi gì). */
  removed: z.boolean(),
  moved_to_group_id: Uuid.nullable(),
  access: OrgAccessChangeSchema,
});
export type DeptMemberRemoveResponse = z.infer<typeof DeptMemberRemoveResponseSchema>;
