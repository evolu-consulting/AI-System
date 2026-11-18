// CR-182 · giao việc theo vai: vai của bước + người được giao (GET `graph[]`) và `PUT /pack/contracts/approval-flow/roles` (chỉ quản trị công ty).
import { z } from "zod";
import { UuidSchema } from "../common";
import { RoleKeySchema } from "../hub-admin/process-group-refs";

/** CR-182 · vai của một bước (khoá + nhãn nghiệp vụ) và người đang được giao cho vai đó. */
export const ApprovalFlowRoleSchema = z.strictObject({
  key: RoleKeySchema,
  label: z.string().min(1).max(80),
});
export const APPROVAL_FLOW_MEMBERS_MAX = 50;
export const ApprovalFlowAssignedSchema = z.strictObject({
  kind: z.enum(["group", "user"]),
  id: UuidSchema,
  name: z.string().max(200).nullable(),
  /** Nhóm ⇒ thành viên dùng được (≤ 50); người ⇒ chính người đó. */
  members: z
    .array(z.strictObject({ id: UuidSchema, name: z.string().max(200) }))
    .max(APPROVAL_FLOW_MEMBERS_MAX),
});
export type ApprovalFlowAssigned = z.infer<typeof ApprovalFlowAssignedSchema>;
/** `PUT /pack/contracts/approval-flow/roles` · chỉ quản trị công ty · `group_id` xor `user_id`; cả hai vắng/null ⇒ bỏ giao. */
export const ApprovalFlowRoleAssignSchema = z
  .strictObject({
    flow_id: UuidSchema,
    role_key: RoleKeySchema,
    group_id: UuidSchema.nullable().optional(),
    user_id: UuidSchema.nullable().optional(),
  })
  .refine((v) => !(v.group_id && v.user_id), { message: "group_id xor user_id" });
export type ApprovalFlowRoleAssign = z.infer<typeof ApprovalFlowRoleAssignSchema>;
export const ApprovalFlowRoleAssignedSchema = z.strictObject({
  flow_id: UuidSchema,
  role_key: RoleKeySchema,
  assigned: ApprovalFlowAssignedSchema.nullable(),
});
export type ApprovalFlowRoleAssigned = z.infer<typeof ApprovalFlowRoleAssignedSchema>;
