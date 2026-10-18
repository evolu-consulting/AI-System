// HUB-FR-107 · HUB-FR-110 · HUB-FR-111 · M5 · C4 · R-TK01…R-TK05 — `canAct`, `askExcerpt`, `decisionAssignees`
// (askExcerpt: core/task.rules.ts; canAct: domain/tasks/task-access.rules.ts; decisionAssignees: domain/tasks/decision.rules.ts, plan-contract §7, plan-step0 §1).
import { describe, expect, it } from "bun:test";
import { fn, loadCoreRules, tryLoad } from "../../_support/modules";

const ACME = "a1000000-0000-4000-8000-000000000001";
const BETA = "a1000000-0000-4000-8000-000000000002";
const PLAT = "a1000000-0000-4000-8000-000000000003";
const A = "a5a00000-0000-4000-8000-00000000b001"; // người bắt đầu
const B = "a5a00000-0000-4000-8000-00000000b002"; // thuộc Group duyệt G
const X = "a5a00000-0000-4000-8000-00000000b003"; // thành viên khác
const F = "a5a00000-0000-4000-8000-00000000b004"; // người đã chuyển (vẫn trong userIds)
const G = "a5a00000-0000-4000-8000-00000000b0f1";
type Role = "platform_admin" | "tenant_admin" | "member";
const v = (userId: string, groups: string[] = [], role: Role = "member", tenantId = ACME) => ({
  userId,
  tenantId,
  role,
  groupIds: new Set(groups),
});
type TaskO = Partial<{
  kind: string;
  status: string;
  reason: string | null;
  userIds: string[];
  groupId: string | null;
}>;
const task = (o: TaskO = {}) => ({
  kind: o.kind ?? "review",
  status: o.status ?? "open",
  reason: o.reason ?? null,
  userIds: new Set(o.userIds ?? [A, F]),
  groupId: o.groupId === undefined ? G : o.groupId,
  reviewGroupId: G,
});
const run = (status = "waiting_review") => ({
  tenantId: ACME,
  startedBy: A,
  originRoom: "member",
  taskAssignee: false,
  status,
});
const T = async (name: string) => fn(await loadCoreRules("task"), name);
const TA = async (name: string) =>
  fn(await tryLoad("apps/hub-api/src/modules/processes/domain/tasks/task-access.rules.ts"), name);
const DEC = async (name: string) =>
  fn(await tryLoad("apps/hub-api/src/modules/processes/domain/tasks/decision.rules.ts"), name);

describe("R-TK · task dùng chung [plan-step0 §1]", () => {
  it("HUB-FR-107 · R-TK01 · review open: user trong userIds / thuộc group ⇒ true; ngoài cả hai ⇒ false; người đã chuyển ⇒ true", async () => {
    const f = await TA("canAct");
    expect(f(v(A), task(), run())).toBe(true);
    expect(f(v(B, [G]), task(), run())).toBe(true);
    expect(f(v(X), task(), run())).toBe(false);
    expect(f(v(F), task(), run())).toBe(true);
  });
  it("HUB-FR-107 · R-TK02 · task closed / run kết thúc / tenant khác ⇒ false; platform_admin task open ⇒ true", async () => {
    const f = await TA("canAct");
    expect(f(v(A), task({ status: "closed" }), run())).toBe(false);
    for (const s of ["cancelled", "done", "expired"]) expect(f(v(A), task(), run(s))).toBe(false);
    const dec = task({ kind: "decision", reason: "redo_limit", userIds: [A] });
    expect(f(v(A, [], "member", BETA), task(), run())).toBe(false);
    expect(f(v(B, [], "tenant_admin", BETA), dec, run("needs_decision"))).toBe(false);
    expect(f(v(B, [], "platform_admin", PLAT), dec, run("needs_decision"))).toBe(true);
  });
  it("HUB-FR-115 · R-TK03 · decision redo_limit: starter, tenant_admin, B ∈ Group duyệt ⇒ true, X ⇒ false; team_calls: B ⇒ false (M5)", async () => {
    const f = await TA("canAct");
    const r = run("needs_decision");
    const redo = task({ kind: "decision", reason: "redo_limit", userIds: [A] });
    expect(f(v(A), redo, r)).toBe(true);
    expect(f(v(X, [], "tenant_admin"), redo, r)).toBe(true);
    expect(f(v(B, [G]), redo, r)).toBe(true);
    expect(f(v(X), redo, r)).toBe(false);
    const team = task({ kind: "decision", reason: "team_calls", userIds: [A], groupId: null });
    expect(f(v(B, [G]), team, r)).toBe(false);
  });
  it("HUB-FR-110 · R-TK04 · askExcerpt ≤ 1 000 ký tự đầu, không cắt đôi ký tự (C4)", async () => {
    const f = await T("askExcerpt");
    const long = "x".repeat(1_500);
    expect(f(long)).toBe("x".repeat(1_000));
    expect(f("Hoá đơn HD-12 tháng 9")).toBe("Hoá đơn HD-12 tháng 9");
    expect(f(long, 50)).toBe("x".repeat(50));
    const emoji = `${"a".repeat(999)}😀${"b".repeat(10)}`;
    const out: string = f(emoji);
    expect(emoji.startsWith(out)).toBe(true);
    expect(/[\uD800-\uDBFF]$/.test(out)).toBe(false);
    expect(Array.from(out).length).toBeLessThanOrEqual(1_000);
    expect(out.length).toBeGreaterThanOrEqual(999);
  });
  it("HUB-FR-115 · R-TK05 · decisionAssignees: group chỉ khi redo_limit; không tenant_admin", async () => {
    const f = await DEC("decisionAssignees");
    expect(f("redo_limit", A, G)).toEqual({ userIds: [A], groupId: G });
    expect(f("redo_limit", A, null)).toEqual({ userIds: [A], groupId: null });
    for (const r of ["team_calls", "ask_limit", "permission_lost"])
      expect(f(r, A, G)).toEqual({ userIds: [A], groupId: null });
  });
});
