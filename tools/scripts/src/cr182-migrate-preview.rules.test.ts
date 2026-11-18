import { describe, expect, it } from "bun:test";
import { previewPlan } from "./cr182-migrate-preview.rules";

const G = "11111111-1111-4111-8111-111111111111";
const G2 = "22222222-2222-4222-8222-222222222222";
const c = (v: string) => ({ from: "const", value: v });
const sign = (v: string) => ({
  executor: { kind: "tool", tool_key: "contracts-esign-send", args: { company_signers: c(v) } },
});
const base = {
  groupIds: new Set([`t1:${G}`]),
  groupKeys: new Set(["t1:ga"]),
  assigned: new Map([["lib", ["t1", "t2"]]]),
  activeRuns: new Map([["d1", 3]]),
};

describe("cr182-migrate-preview · luật xem trước", () => {
  it("đếm def/bước/công ty/lượt; stage đã có vai bị bỏ qua", () => {
    const o = previewPlan({
      ...base,
      defs: [
        {
          id: "d1",
          tenant_id: "t1",
          key: "d1",
          stages: [
            { after: { kind: "review", group_id: G } },
            sign(`group:${G}`),
            { after: { kind: "review", group_id: G, role: { key: "x", label: "X" } } },
          ],
        },
      ],
    });
    expect(o).toMatchObject({
      defs: 1,
      stages: 2,
      tenants: ["t1"],
      activeRuns: 3,
      ambiguous: [],
      unassigned: [],
    });
  });
  it("mơ hồ: Ký nhiều người, Ký ở mẫu Thư viện; chưa giao: nhóm không có / công ty thiếu nhóm cùng mã", () => {
    const o = previewPlan({
      ...base,
      defs: [
        { id: "d2", tenant_id: "t1", key: "multi", stages: [sign(`user:${G2},group:${G}`)] },
        {
          id: "lib",
          tenant_id: null,
          key: "lib",
          stages: [{ after: { kind: "review", group_key: "ga" } }, sign(`group:${G}`)],
        },
        {
          id: "d3",
          tenant_id: "t1",
          key: "gone",
          stages: [{ after: { kind: "review", group_id: G2 } }],
        },
      ],
    });
    expect(o.ambiguous.length).toBe(2);
    expect(o.unassigned.some((l) => l.includes("lib · công ty t2"))).toBe(true);
    expect(o.unassigned.some((l) => l.includes("gone"))).toBe(true);
    expect(o.unassigned.some((l) => l.includes("lib · công ty t1"))).toBe(false);
    expect(o.tenants).toEqual(["t1", "t2"]);
  });
});

describe("cr182-migrate-preview · vừa nhóm vừa người, khe mặc định", () => {
  it("chỗ có nhiều hơn một đích cũ ⇒ Mơ hồ, không đếm là được điền vai; mẫu Thư viện mặc định của khe được liệt kê", () => {
    const o = previewPlan({
      ...base,
      slotDefaults: new Set(["lib"]),
      defs: [
        {
          id: "d4",
          tenant_id: "t1",
          key: "both",
          stages: [{ after: { kind: "review", group_id: G, approver_user_id: G2 } }],
        },
        {
          id: "lib",
          tenant_id: null,
          key: "lib",
          stages: [{ after: { kind: "review", group_key: "ga" } }],
        },
      ],
    });
    expect(o.ambiguous.some((l) => l.startsWith("both · bước 1"))).toBe(true);
    expect(o.defs).toBe(1);
    expect(o.viaSlot).toEqual(["lib"]);
  });
});
