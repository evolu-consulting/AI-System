// ADM-FR-73 · AC-A15 · TT-R03 (plan-contract §6) · công tắc tool theo tenant: chỉ platform_admin.
// GET /admin/tenants/:id/workflow-tools · PUT|DELETE /admin/tenants/:id/workflow-tools/:workflow_id.
import { z } from "zod";
import { CatalogKeySchema, IsoDateTime, UpdatedBySchema, UuidSchema } from "./common";

/** Trần danh sách: mọi workflow catalog (sắp `key`). */
export const TENANT_WORKFLOW_TOOLS_MAX = 200;

/** `granted_at`/`granted_by` null khi chưa từng bật hoặc đã tắt. */
export const TenantWorkflowToolSchema = z.strictObject({
  workflow_id: UuidSchema,
  key: CatalogKeySchema,
  name: z.string().min(1).max(128),
  side_effect: z.boolean(),
  enabled: z.boolean(),
  on: z.boolean(),
  granted_at: IsoDateTime.nullable(),
  granted_by: UpdatedBySchema,
});
export type TenantWorkflowTool = z.infer<typeof TenantWorkflowToolSchema>;

export const TenantWorkflowToolListSchema = z.strictObject({
  items: z.array(TenantWorkflowToolSchema).max(TENANT_WORKFLOW_TOOLS_MAX),
});
export type TenantWorkflowToolList = z.infer<typeof TenantWorkflowToolListSchema>;

/** Body PUT (bật): rỗng, strict — thừa trường ⇒ 400. */
export const TenantWorkflowToolPutSchema = z.strictObject({});
