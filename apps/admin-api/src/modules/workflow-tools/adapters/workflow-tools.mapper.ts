// ADM-FR-73 · TT-R03 · view lớp 2 ⇒ contract `TenantWorkflowTool` + audit `workflow` grant/revoke before/after `{on}`.
import type { AiTool, TenantWorkflowTool, WorkflowCompany } from "@ai/contracts/workflow-tools";
import type { AuditInput } from "@ai/db";
import { auditOf } from "../../../lib/audit/audit.write";
import type { CompanyView, ToolAudit, ToolView, UsageView } from "../application";

export function toTenantWorkflowTool(v: ToolView): TenantWorkflowTool {
  return {
    workflow_id: v.workflowId,
    key: v.key,
    name: v.name,
    side_effect: v.sideEffect,
    enabled: v.enabled,
    on: v.on,
    granted_at: v.grantedAt ? v.grantedAt.toISOString() : null,
    granted_by: v.grantedBy,
  };
}

export function toAiTool(v: UsageView): AiTool {
  return {
    kind: v.kind,
    id: v.id,
    name: v.name,
    description: v.description,
    enabled: v.enabled,
    side_effect: v.sideEffect,
    companies_count: v.companiesCount,
    companies: v.companies,
  };
}
export function toWorkflowCompany(v: CompanyView): WorkflowCompany {
  return {
    tenant_id: v.tenantId,
    name: v.name,
    on: v.on,
    granted_at: v.grantedAt ? v.grantedAt.toISOString() : null,
    granted_by: v.on ? v.grantedBy : null,
  };
}

/** `entity:"workflow"`, `tenant_id` = tenant, `entity_id` = workflow, `entity_name` = key (plan-contract §6). */
export function toolAudit(a: ToolAudit): AuditInput {
  const on = a.action === "grant";
  return auditOf(a.action, "workflow", {
    entityId: a.workflowId,
    entityName: a.key,
    tenantId: a.tenantId,
    before: { on: !on },
    after: { on },
  });
}
