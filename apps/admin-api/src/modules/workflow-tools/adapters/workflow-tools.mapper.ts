// ADM-FR-73 · TT-R03 · view lớp 2 ⇒ contract `TenantWorkflowTool` + audit `workflow` grant/revoke before/after `{on}`.
import type { TenantWorkflowTool } from "@ai/contracts";
import type { AuditInput } from "@ai/db";
import { auditOf } from "../../../lib/audit/audit.write";
import type { ToolAudit, ToolView } from "../application";

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
