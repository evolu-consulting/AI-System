// ADM-FR-73 · mapper khớp `TenantWorkflowToolSchema`; audit grant/revoke before/after `{on}` (plan-d2 §6).
import { describe, expect, it } from "bun:test";
import { TenantWorkflowToolSchema } from "@ai/contracts";
import { toolAudit, toTenantWorkflowTool } from "./workflow-tools.mapper";

const V = {
  workflowId: "a5d20000-0000-4000-8000-000000000001",
  key: "xuat-hoa-don",
  name: "Xuất hoá đơn",
  sideEffect: true,
  enabled: true,
  on: true,
  grantedAt: new Date("2026-10-18T02:00:00.000Z"),
  grantedBy: "admin",
};

describe("ADM-FR-73 · workflow-tools.mapper", () => {
  it("ADM-FR-73 · bật / tắt (granted_* null) đều khớp schema", () => {
    const on = toTenantWorkflowTool(V);
    const off = toTenantWorkflowTool({ ...V, on: false, grantedAt: null, grantedBy: null });
    expect(TenantWorkflowToolSchema.safeParse(on).success).toBe(true);
    expect(TenantWorkflowToolSchema.safeParse(off).success).toBe(true);
    expect(on.granted_at).toBe("2026-10-18T02:00:00.000Z");
  });
  it("ADM-FR-73 · audit entity workflow, grant ⇒ {on:false}→{on:true}; revoke ngược lại", () => {
    const a = { tenantId: "t", workflowId: V.workflowId, key: V.key };
    const g = toolAudit({ ...a, action: "grant" });
    const r = toolAudit({ ...a, action: "revoke" });
    expect(g).toMatchObject({
      action: "grant",
      entity: "workflow",
      entityId: V.workflowId,
      entityName: V.key,
      tenantId: "t",
    });
    expect([g.before, g.after, r.before, r.after]).toEqual([
      { on: false },
      { on: true },
      { on: true },
      { on: false },
    ]);
  });
});
