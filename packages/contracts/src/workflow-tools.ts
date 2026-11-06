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

/** Loại công cụ trong danh sách gộp. Hook: admin chưa có nguồn đọc ⇒ chưa có loại này. */
export const AI_TOOL_KINDS = ["agent", "command", "workflow"] as const;

/**
 * Một dòng của danh sách Công cụ AI. `companies_count` = số công ty đang dùng (agent: có grant; lệnh: có tính năng chứa lệnh được cấp;
 * workflow: công tắc đang bật); `companies` ≤ 5 tên đầu để hiện. `name` null = agent (admin chỉ biết id). `description` chỉ workflow.
 */
export const AiToolSchema = z.strictObject({
  kind: z.enum(AI_TOOL_KINDS),
  id: UuidSchema,
  name: z.string().min(1).max(128).nullable(),
  description: z.string().max(2000).nullable(),
  enabled: z.boolean(),
  side_effect: z.boolean(),
  companies_count: Count,
  companies: z.array(z.string().max(200)).max(5),
  /** Tên secret của workflow (lọc "Dùng secret X"); null với agent/lệnh. */
  secret: z.string().max(200).nullable(),
  /** Mã workflow — chỉ để tìm (liên kết từ Secrets theo mã); không hiện. null với agent/lệnh. */
  key: CatalogKeySchema.nullable(),
});
export type AiTool = z.infer<typeof AiToolSchema>;

export const AI_TOOLS_MAX = 600;
export const AiToolListSchema = z.strictObject({
  items: z.array(AiToolSchema).max(AI_TOOLS_MAX),
});
export type AiToolList = z.infer<typeof AiToolListSchema>;
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
