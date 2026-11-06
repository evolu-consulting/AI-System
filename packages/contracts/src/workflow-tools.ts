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

// CR-121 R6 · c16 · trang Công cụ AI (chỉ platform_admin): GET /admin/workflow-tools/usage ("Dùng bởi" cả danh mục, đọc theo tập)
// và GET /admin/workflow-tools/:workflow_id/companies (công ty dùng + công tắc; bật/tắt vẫn qua PUT|DELETE ở trên).
const Count = z.number().int().min(0);

/** Một công cụ AI (workflow Dify) kèm số agent/lệnh gọi tới và số công ty đang bật. */
export const AiToolUsageSchema = z.strictObject({
  workflow_id: UuidSchema,
  key: CatalogKeySchema,
  name: z.string().min(1).max(128),
  description: z.string().max(2000),
  enabled: z.boolean(),
  side_effect: z.boolean(),
  agent_count: Count,
  command_count: Count,
  company_count: Count,
});
export type AiToolUsage = z.infer<typeof AiToolUsageSchema>;

export const AiToolUsageListSchema = z.strictObject({
  items: z.array(AiToolUsageSchema).max(TENANT_WORKFLOW_TOOLS_MAX),
});
export type AiToolUsageList = z.infer<typeof AiToolUsageListSchema>;

/** Trần danh sách công ty của một công cụ. */
export const WORKFLOW_COMPANIES_MAX = 500;

export const WorkflowCompanySchema = z.strictObject({
  tenant_id: UuidSchema,
  name: z.string().min(1).max(200),
  on: z.boolean(),
  granted_at: IsoDateTime.nullable(),
  granted_by: UpdatedBySchema,
});
export type WorkflowCompany = z.infer<typeof WorkflowCompanySchema>;

export const WorkflowCompanyListSchema = z.strictObject({
  items: z.array(WorkflowCompanySchema).max(WORKFLOW_COMPANIES_MAX),
});
export type WorkflowCompanyList = z.infer<typeof WorkflowCompanyListSchema>;

/** Body PUT (bật): rỗng, strict — thừa trường ⇒ 400. */
export const TenantWorkflowToolPutSchema = z.strictObject({});
