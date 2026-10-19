// M1D-FR-02 · docs/specs/M1b-visibility · luật nhập quản lý (cấm vòng, không đè, cùng tenant) + gom lô theo tenant.
import { describe, expect, it } from "bun:test";
import type { OrgUser } from "./import";
import { planManagers, tenantBatches } from "./managers.rules";

const u = (key: string, managerKey: string | null = null): OrgUser => ({
  key,
  id: key,
  managerKey,
});
const w = (email: string, managerEmail: string) => ({ email, managerEmail });

describe("M1D-FR-02 · planManagers", () => {
  it("chuỗi a→b→c đặt đủ theo thứ tự file", () => {
    const p = planManagers([w("a", "b"), w("b", "c")], [u("a"), u("b"), u("c")]);
    expect(p).toEqual({
      sets: [
        { userKey: "a", managerKey: "b" },
        { userKey: "b", managerKey: "c" },
      ],
      existing: 0,
      issues: [],
    });
  });
  it("vòng trong file: a→b, b→a ⇒ cạnh sau bị từ chối MANAGER_CYCLE; tự quản lý ⇒ MANAGER_CYCLE", () => {
    const p = planManagers([w("a", "b"), w("b", "a"), w("c", "c")], [u("a"), u("b"), u("c")]);
    expect(p.sets).toEqual([{ userKey: "a", managerKey: "b" }]);
    expect(p.issues).toEqual([
      { kind: "manager", ref: "b", code: "MANAGER_CYCLE" },
      { kind: "manager", ref: "c", code: "MANAGER_CYCLE" },
    ]);
  });
  it("vòng nhiều tầng qua cạnh đã có trong DB: c đã dưới a (c→b→a) ⇒ a→c bị từ chối", () => {
    const p = planManagers([w("a", "c")], [u("a"), u("b", "a"), u("c", "b")]);
    expect(p.sets).toEqual([]);
    expect(p.issues[0]?.code).toBe("MANAGER_CYCLE");
  });
  it("user đã có quản lý ⇒ không đè (existing); quản lý không có trong tenant ⇒ MANAGER_UNKNOWN; user lạ ⇒ bỏ qua", () => {
    const p = planManagers(
      [w("a", "c"), w("b", "x@other"), w("ghost", "a")],
      [u("a", "b"), u("b"), u("c")],
    );
    expect(p).toEqual({
      sets: [],
      existing: 1,
      issues: [{ kind: "manager", ref: "b", code: "MANAGER_UNKNOWN" }],
    });
  });
  it("trùng user trong file: cạnh đầu thắng, lần sau tính existing", () => {
    const p = planManagers([w("a", "b"), w("a", "c")], [u("a"), u("b"), u("c")]);
    expect({ sets: p.sets.length, existing: p.existing }).toEqual({ sets: 1, existing: 1 });
  });
});

describe("M1D-FR-02 · tenantBatches", () => {
  it("tổng cặp mỗi lô ≤ n, không tách tenant (tenant lớn hơn n đứng riêng)", () => {
    const m = new Map<string, number[]>([
      ["t1", [1, 2]],
      ["t2", [1]],
      ["t3", [1, 2, 3, 4]],
      ["t4", [1]],
    ]);
    expect(tenantBatches(m, 3)).toEqual([["t1", "t2"], ["t3"], ["t4"]]);
  });
});
