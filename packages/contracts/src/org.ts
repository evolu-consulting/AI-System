// M1D-FR-02 · M1D-FR-03 · docs/specs/M1-departments: cơ cấu tổ chức của tenant (quản lý trực tiếp + phòng ban) — admin-api
// `/admin/org*`, màn Cài đặt › Phòng ban của contracts-web. Phòng ban = Group (`/admin/groups`) + trưởng phòng.
import { z } from "zod";
import { UuidSchema as Uuid } from "./common";

export const ORG_MEMBERS_MAX = 2000;

export const OrgQuerySchema = z.object({ tenant_id: Uuid.optional() });
export type OrgQuery = z.infer<typeof OrgQuerySchema>;

export const OrgMemberSchema = z.object({
  user_id: Uuid,
  username: z.string(),
  display_name: z.string(),
  manager_id: Uuid.nullable(),
});
export type OrgMember = z.infer<typeof OrgMemberSchema>;

export const OrgDepartmentSchema = z.object({
  group_id: Uuid,
  key: z.string(),
  name: z.string(),
  head_user_id: Uuid.nullable(),
  member_ids: z.array(Uuid),
});
export type OrgDepartment = z.infer<typeof OrgDepartmentSchema>;

export const OrgResponseSchema = z.object({
  members: z.array(OrgMemberSchema),
  departments: z.array(OrgDepartmentSchema),
});
export type OrgResponse = z.infer<typeof OrgResponseSchema>;

/** `PUT /admin/org/managers/:user_id` — null = bỏ quản lý. Vòng ⇒ 400 VALIDATION_ERROR `details.reason = "manager_cycle"`. */
export const ManagerSetRequestSchema = z.strictObject({ manager_id: Uuid.nullable() });
export type ManagerSetRequest = z.infer<typeof ManagerSetRequestSchema>;

/** `PUT /admin/org/departments/:group_id` — đánh dấu Group là phòng ban + trưởng phòng (null = chưa có). */
export const DepartmentSetRequestSchema = z.strictObject({ head_user_id: Uuid.nullable() });
export type DepartmentSetRequest = z.infer<typeof DepartmentSetRequestSchema>;
