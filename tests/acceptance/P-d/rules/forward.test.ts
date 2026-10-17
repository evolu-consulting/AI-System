// HUB-FR-145 · HUB-FR-107 · HUB-BR-25 · AC-H42 · PD-R21 — `domain/asks/forward.rules.ts` `forwardCheck(t, to, by)`
// (tách nguyên `asks/ask.rules.ts` ở T9s; plan-domain §4.15). test-plan-rules PD-U86…U88 (U88 hồi quy R-AK01…03).
import { describe, expect, it } from "bun:test";
import { domainFn } from "../_support/modules";

const load = () => domainFn("asks/forward.rules.ts", "forwardCheck");

const G1 = "a5d00000-0000-4000-8000-0000000000a1"; // Group duyệt Kế toán
const G2 = "a5d00000-0000-4000-8000-0000000000a2"; // Group chuyển cấp Giám đốc
const B = "a5d00000-0000-4000-8000-0000000000b1"; // G1
const T = "a5d00000-0000-4000-8000-0000000000b2"; // G1
const H = "a5d00000-0000-4000-8000-0000000000b3"; // G2
const H2 = "a5d00000-0000-4000-8000-0000000000b4"; // G2

const review = (escalatedGroupId: string | null, byGroupIds?: string[]) => ({
  kind: "review" as const,
  status: "open" as const,
  forwards: 0,
  groupId: G1,
  assigneeIds: new Set<string>(),
  escalatedGroupId,
  ...(byGroupIds ? { byGroupIds: new Set(byGroupIds) } : {}),
});
const user = (id: string, groups: string[]) => ({
  id,
  active: true,
  sameTenant: true,
  groupIds: new Set(groups),
});

describe("forwardCheck sau chuyển cấp [PD-R21]", () => {
  it("HUB-FR-145 · AC-H42 · PD-U86 · review G1 chuyển cấp G2: H (G2) chuyển cho B (chỉ G1) ⇒ FORWARD_OUT_OF_GROUP", async () => {
    const f = await load();
    expect(f(review(G2, [G2]), user(B, [G1]), H)).toBe("FORWARD_OUT_OF_GROUP");
  });
  it("HUB-FR-145 · HUB-FR-107 · PD-U87 · B (G1) → T (G1) ⇒ ok; H (G2) → H2 (G2) ⇒ ok; không byGroupIds ⇒ tập {G1, G2}", async () => {
    const f = await load();
    expect(f(review(G2, [G1]), user(T, [G1]), B)).toBe("ok");
    expect(f(review(G2, [G2]), user(H2, [G2]), H)).toBe("ok");
    expect(f(review(G2), user(H2, [G2]), H)).toBe("ok");
    expect(f(review(G2), user(T, [G1]), H)).toBe("ok");
    expect(f(review(G2), user(T, []), H)).toBe("FORWARD_OUT_OF_GROUP");
  });
});

// PD-U88 — dữ liệu chép nguyên từ P-a/pf2/rules/ask.test.ts (R-AK01…03); task KHÔNG có escalatedGroupId/byGroupIds.
const A = "a5a00000-0000-4000-8000-00000000c001"; // người chuyển (assignee)
const HA = "a5a00000-0000-4000-8000-00000000c002"; // đích hợp lệ
const BA = "a5a00000-0000-4000-8000-00000000c003"; // đã là assignee
const G = "a5a00000-0000-4000-8000-00000000c0f1"; // Group duyệt
type K = "review" | "ask" | "decision";
const task = (
  o: Partial<{ kind: K; status: "open" | "closed"; forwards: number; groupId: string | null }> = {},
) => ({
  kind: o.kind ?? "ask",
  status: o.status ?? "open",
  forwards: o.forwards ?? 0,
  groupId: o.groupId === undefined ? null : o.groupId,
  assigneeIds: new Set([A, BA]),
});
const to = (
  o: Partial<{ id: string; active: boolean; sameTenant: boolean; groups: string[] }> = {},
) => ({
  id: o.id ?? HA,
  active: o.active ?? true,
  sameTenant: o.sameTenant ?? true,
  groupIds: new Set(o.groups ?? []),
});

describe("forwardCheck hồi quy — vắng trường mới [R-AK01…03]", () => {
  it("HUB-FR-107 · PD-U88 · R-AK01 · decision ⇒ TASK_KIND_MISMATCH; closed ⇒ REVIEW_TASK_CLOSED; 3 lần ⇒ FORWARD_LIMIT; closed + 3 ⇒ CLOSED", async () => {
    const f = await load();
    expect(f(task({ kind: "decision" }), to(), A)).toBe("TASK_KIND_MISMATCH");
    expect(f(task({ status: "closed" }), to(), A)).toBe("REVIEW_TASK_CLOSED");
    expect(f(task({ forwards: 3 }), to(), A)).toBe("FORWARD_LIMIT");
    expect(f(task({ status: "closed", forwards: 3 }), to(), A)).toBe("REVIEW_TASK_CLOSED");
  });
  it("HUB-FR-107 · PD-U88 · R-AK02 · review: đích ∉ Group ⇒ FORWARD_OUT_OF_GROUP; đích ∈ Group ⇒ ok", async () => {
    const f = await load();
    expect(f(task({ kind: "review", groupId: G }), to({ groups: [] }), A)).toBe(
      "FORWARD_OUT_OF_GROUP",
    );
    expect(f(task({ kind: "review", groupId: G }), to({ groups: [G] }), A)).toBe("ok");
  });
  it("HUB-FR-107 · PD-U88 · R-AK03 · ask: đích inactive / khác tenant / chính mình / đã assignee ⇒ FORWARD_TARGET_INVALID; hợp lệ ⇒ ok", async () => {
    const f = await load();
    expect(f(task(), to({ active: false }), A)).toBe("FORWARD_TARGET_INVALID");
    expect(f(task(), to({ sameTenant: false }), A)).toBe("FORWARD_TARGET_INVALID");
    expect(f(task(), to({ id: A }), A)).toBe("FORWARD_TARGET_INVALID");
    expect(f(task(), to({ id: BA }), A)).toBe("FORWARD_TARGET_INVALID");
    expect(f(task(), to(), A)).toBe("ok");
  });
});
