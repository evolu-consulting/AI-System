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
