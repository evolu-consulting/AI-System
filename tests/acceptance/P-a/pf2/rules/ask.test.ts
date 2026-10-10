// HUB-FR-110 · HUB-FR-111 · AC-H30 · R-AK01…R-AK03 — `forwardCheck` (asks/ask.rules.ts, plan-contract §7; plan §3.4 Forward).
// Đỏ trước code ở `fn()` (module vắng ⇒ `{}`), test-plan §5.
import { describe, expect, it } from "bun:test";
import { fn, loadProcRules } from "../../_support/modules";

const A = "a5a00000-0000-4000-8000-00000000c001"; // người chuyển (assignee)
const H = "a5a00000-0000-4000-8000-00000000c002"; // đích hợp lệ
const B = "a5a00000-0000-4000-8000-00000000c003"; // đã là assignee
const G = "a5a00000-0000-4000-8000-00000000c0f1"; // Group duyệt
type K = "review" | "ask" | "decision";
const task = (
  o: Partial<{ kind: K; status: "open" | "closed"; forwards: number; groupId: string | null }> = {},
) => ({
  kind: o.kind ?? "ask",
  status: o.status ?? "open",
  forwards: o.forwards ?? 0,
  groupId: o.groupId === undefined ? null : o.groupId,
  assigneeIds: new Set([A, B]),
});
const to = (
  o: Partial<{ id: string; active: boolean; sameTenant: boolean; groups: string[] }> = {},
) => ({
  id: o.id ?? H,
  active: o.active ?? true,
  sameTenant: o.sameTenant ?? true,
  groupIds: new Set(o.groups ?? []),
});
const load = async () => fn(await loadProcRules("asks/ask.rules.ts"), "forwardCheck");

describe("forwardCheck [HUB-FR-111]", () => {
  it("HUB-FR-111 · R-AK01 · decision ⇒ TASK_KIND_MISMATCH; closed ⇒ REVIEW_TASK_CLOSED; 3 lần chuyển ⇒ FORWARD_LIMIT; closed + 3 ⇒ CLOSED (closed trước)", async () => {
    const f = await load();
    expect(f(task({ kind: "decision" }), to(), A)).toBe("TASK_KIND_MISMATCH");
    expect(f(task({ status: "closed" }), to(), A)).toBe("REVIEW_TASK_CLOSED");
    expect(f(task({ forwards: 3 }), to(), A)).toBe("FORWARD_LIMIT");
    expect(f(task({ status: "closed", forwards: 3 }), to(), A)).toBe("REVIEW_TASK_CLOSED");
  });
  it("HUB-FR-107 · R-AK02 · review: đích ∉ Group ⇒ FORWARD_OUT_OF_GROUP; đích ∈ Group ⇒ ok", async () => {
    const f = await load();
    expect(f(task({ kind: "review", groupId: G }), to({ groups: [] }), A)).toBe(
      "FORWARD_OUT_OF_GROUP",
    );
    expect(f(task({ kind: "review", groupId: G }), to({ groups: [G] }), A)).toBe("ok");
  });
  it("HUB-FR-111 · R-AK03 · ask: đích inactive / khác tenant / chính mình / đã assignee ⇒ FORWARD_TARGET_INVALID; user active cùng tenant ⇒ ok", async () => {
    const f = await load();
    expect(f(task(), to({ active: false }), A)).toBe("FORWARD_TARGET_INVALID");
    expect(f(task(), to({ sameTenant: false }), A)).toBe("FORWARD_TARGET_INVALID");
    expect(f(task(), to({ id: A }), A)).toBe("FORWARD_TARGET_INVALID");
    expect(f(task(), to({ id: B }), A)).toBe("FORWARD_TARGET_INVALID");
    expect(f(task(), to(), A)).toBe("ok");
  });
});
