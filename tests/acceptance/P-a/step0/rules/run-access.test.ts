// HUB-BR-25 · HUB-FR-105 · M1 · M5 · U5 · R-A01…R-A09 — `runAccess`, `canCancel`, `canDecide`, `canRun`, `canReadThread`
// (domain/runs/run-access.rules.ts, plan §5, plan-contract §7).
import { describe, expect, it } from "bun:test";
import { fn, tryLoad } from "../../_support/modules";

const ACME = "a1000000-0000-4000-8000-000000000001";
const BETA = "a1000000-0000-4000-8000-000000000002";
const PLAT = "a1000000-0000-4000-8000-000000000003";
const A = "a5a00000-0000-4000-8000-00000000a001";
const B = "a5a00000-0000-4000-8000-00000000a002";
type Role = "platform_admin" | "tenant_admin" | "member";
const v = (userId: string, role: Role = "member", tenantId = ACME) => ({ userId, tenantId, role });
const facts = (
  o: Partial<{ originRoom: string; taskAssignee: boolean; tenantId: string }> = {},
) => ({
  tenantId: o.tenantId ?? ACME,
  startedBy: A,
  originRoom: o.originRoom ?? "member",
  taskAssignee: o.taskAssignee ?? false,
});
const R = async (name: string) =>
  fn(await tryLoad("apps/hub-api/src/modules/processes/domain/runs/run-access.rules.ts"), name);
const REASONS = [
  "redo_limit",
  "ask_limit",
  "template_invalid",
  "team_calls",
  "team_tokens",
  "team_time",
  "team_no_change",
  "job_timeout",
  "stage_tokens",
  "run_tokens",
  "agent_failed",
  "permission_lost",
  "user_inactive",
  "interrupted",
];

describe("R-A · quyền xem/thao tác run [HUB-BR-25]", () => {
  it("HUB-BR-25 · R-A01 · starter còn ở R / run không phòng; thành viên phòng; tenant_admin; platform_admin ⇒ full", async () => {
    const f = await R("runAccess");
    expect(f(v(A), facts({ originRoom: "member" }))).toBe("full");
    expect(f(v(A), facts({ originRoom: "none" }))).toBe("full");
    expect(f(v(A), facts({ originRoom: "deleted" }))).toBe("full");
    expect(f(v(B), facts({ originRoom: "member" }))).toBe("full");
    expect(f(v(B, "tenant_admin"), facts({ originRoom: "outside" }))).toBe("full");
    expect(f(v(B, "platform_admin", PLAT), facts({ originRoom: "outside" }))).toBe("full");
  });
  it("HUB-BR-25 · R-A02 · assignee ngoài phòng ⇒ task; assignee + thành viên ⇒ full", async () => {
    const f = await R("runAccess");
    expect(f(v(B), facts({ originRoom: "outside", taskAssignee: true }))).toBe("task");
    expect(f(v(B), facts({ originRoom: "member", taskAssignee: true }))).toBe("full");
  });
  it("HUB-BR-25 · R-A03 · user khác cùng tenant / đã rời phòng không assignee / run null ⇒ null (404)", async () => {
    const f = await R("runAccess");
    expect(f(v(B), facts({ originRoom: "outside" }))).toBeNull();
    expect(f(v(B), facts({ originRoom: "none" }))).toBeNull();
    expect(f(v(B), null)).toBeNull();
  });
  it("HUB-BR-25 · R-A04 · tenant_admin / starter-id ở tenant khác ⇒ null", async () => {
    const f = await R("runAccess");
    expect(f(v(B, "tenant_admin", BETA), facts())).toBeNull();
    expect(f(v(A, "member", BETA), facts())).toBeNull();
  });
  it("HUB-FR-106 · R-A05 · canCancel: starter (kể cả đã rời R), tenant_admin, platform_admin; không: thành viên, assignee, admin tenant khác", async () => {
    const f = await R("canCancel");
    expect(f(v(A), facts())).toBe(true);
    expect(f(v(B, "tenant_admin"), facts())).toBe(true);
    expect(f(v(B, "platform_admin", PLAT), facts())).toBe(true);
    expect(f(v(A), facts({ originRoom: "outside" }))).toBe(true);
    expect(f(v(B), facts({ originRoom: "member" }))).toBe(false);
    expect(f(v(B), facts({ originRoom: "outside", taskAssignee: true }))).toBe(false);
    expect(f(v(B, "tenant_admin", BETA), facts())).toBe(false);
  });
  it("HUB-FR-115 · R-A06 · canDecide (M5, U5): starter/tenant_admin mọi lý do; reviewGroupMember chỉ redo_limit; thành viên không", async () => {
    const f = await R("canDecide");
    const d = (
      reason: string,
      o: Partial<{ originRoom: string; reviewGroupMember: boolean }> = {},
    ) => ({
      ...facts({ originRoom: o.originRoom }),
      reason,
      reviewGroupMember: o.reviewGroupMember ?? false,
    });
    for (const r of REASONS) {
      expect(f(v(A), d(r))).toBe(true);
      expect(f(v(B, "tenant_admin"), d(r))).toBe(true);
      expect(f(v(A), d(r, { originRoom: "outside" }))).toBe(true);
      expect(f(v(B), d(r))).toBe(false);
    }
    expect(f(v(B), d("redo_limit", { reviewGroupMember: true }))).toBe(true);
    for (const r of REASONS.filter((x) => x !== "redo_limit"))
      expect(f(v(B), d(r, { reviewGroupMember: true }))).toBe(false);
  });
  it("HUB-FR-105 · R-A07 · canRun (M1): inactive / tắt / xoá ⇒ false; run group rỗng ⇒ true; thuộc / không thuộc group", async () => {
    const f = await R("canRun");
    const g = "a5a00000-0000-4000-8000-00000000a0f1";
    const u = (active: boolean, groups: string[] = []) => ({ active, groupIds: new Set(groups) });
    const d = (o: Partial<{ enabled: boolean; deleted: boolean; runGroupIds: string[] }> = {}) => ({
      enabled: o.enabled ?? true,
      deleted: o.deleted ?? false,
      runGroupIds: o.runGroupIds ?? [],
    });
    expect(f(u(false), d())).toBe(false);
    expect(f(u(true), d({ enabled: false }))).toBe(false);
    expect(f(u(true), d({ deleted: true }))).toBe(false);
    expect(f(u(true), d())).toBe(true);
    expect(f(u(true, [g]), d({ runGroupIds: [g] }))).toBe(true);
    expect(f(u(true), d({ runGroupIds: [g] }))).toBe(false);
  });
  it("HUB-BR-25 · R-A08 · starter đã rời R (U5), không assignee ⇒ task (không full, không null)", async () => {
    const f = await R("runAccess");
    expect(f(v(A), facts({ originRoom: "outside" }))).toBe("task");
  });
  it("HUB-BR-25 · R-A09 · canReadThread: chỉ originRoom=member ⇒ true", async () => {
    const f = await R("canReadThread");
    expect(f(v(B), facts({ originRoom: "member" }))).toBe(true);
    expect(f(v(A), facts({ originRoom: "outside" }))).toBe(false);
    expect(f(v(B), facts({ originRoom: "outside", taskAssignee: true }))).toBe(false);
    expect(f(v(B, "tenant_admin"), facts({ originRoom: "outside" }))).toBe(false);
    expect(f(v(B, "platform_admin", PLAT), facts({ originRoom: "outside" }))).toBe(false);
  });
});
