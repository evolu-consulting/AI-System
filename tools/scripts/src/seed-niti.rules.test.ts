import { describe, expect, it } from "bun:test";
import { NITI_SPEC } from "./seed-niti.data";
import {
  applyGuard,
  canon,
  conditionOf,
  credLine,
  sameRules,
  slotBodyOf,
  tenantShape,
} from "./seed-niti.rules";

describe("seed-niti rules", () => {
  it("bước duyệt = phòng ban, cổng trưởng phòng", () => {
    const p = NITI_SPEC.processes[0];
    const b = slotBodyOf(p as never);
    expect(b.steps.map((s) => s.department_group_key)).toEqual(["pb-ke-toan", "pb-giam-doc"]);
    expect(b.steps.every((s) => s.head_only === true && s.department_group_id === null)).toBe(true);
  });

  it("điều kiện luật = phòng × loại HĐ (một chỗ biết hình)", () => {
    expect(conditionOf({ dept: "d", kind: "sell", process: "p" }, "id1")).toEqual({
      departmentIds: ["id1"],
      contractKinds: ["sell"],
    });
  });

  it("sameRules bỏ thứ tự khoá, nhạy thứ tự luật", () => {
    const a = {
      condition: { departmentIds: ["1"], contractKinds: ["buy"] },
      def_id: "x",
      is_default: false,
    };
    const b = {
      condition: { contractKinds: ["buy"], departmentIds: ["1"] },
      def_id: "x",
      is_default: false,
    };
    expect(sameRules([a], [b])).toBe(true);
    expect(sameRules([a, { ...a, def_id: "y" }], [{ ...a, def_id: "y" }, a])).toBe(false);
    expect(canon({ b: 1, a: [2] })).toBe(canon({ a: [2], b: 1 }));
  });

  it("tenant: chỉ chấp nhận không có hoặc trùng cả khoá lẫn tên", () => {
    const s = { tenantKey: "k", tenantName: "N" };
    expect(tenantShape(s, [])).toBe("absent");
    expect(tenantShape(s, [{ key: "k", name: "N" }])).toBe("present");
    expect(tenantShape(s, [{ key: "k", name: "Other" }])).toContain("khác hình dạng");
    expect(tenantShape(s, [{ key: "z", name: "N" }])).toContain("khác hình dạng");
  });

  it("guard: apply ngoài localhost hoặc production cần --i-know-prod, chạy thử luôn được", () => {
    const base = { iKnowProd: false, appEnv: undefined, urls: ["postgres://u@pg:5432/x"] };
    expect(applyGuard({ ...base, apply: false })).toBeNull();
    expect(applyGuard({ ...base, apply: true })).toContain("--i-know-prod");
    expect(applyGuard({ ...base, apply: true, iKnowProd: true })).toBeNull();
    expect(applyGuard({ ...base, apply: true, urls: ["postgres://u@localhost/x"] })).toBeNull();
    expect(
      applyGuard({
        ...base,
        apply: true,
        urls: ["postgres://u@localhost/x"],
        appEnv: "production",
      }),
    ).toContain("production");
  });

  it("dòng file mật khẩu có tab và xuống dòng", () => {
    expect(credLine("t", "u", "pw")).toBe("t\tu\tpw\n");
  });
});
