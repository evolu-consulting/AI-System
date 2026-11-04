// CR-118 §11.2 · unit `pickProcess`: thứ tự, phòng ban con (qua tập tổ tiên), mặc định, không mặc định ⇒ chặn.
import { describe, expect, it } from "bun:test";
import { pickProcess, type RoutingRule } from "./routing.rules";

const rule = (id: string, priority: number, depts: string[], isDefault = false): RoutingRule => ({
  id,
  priority,
  condition: { departmentIds: depts },
  defId: `def-${id}`,
  isDefault,
});

describe("pickProcess", () => {
  const rules = [
    rule("dflt", 2, [], true),
    rule("sales", 1, ["d-sales"]),
    rule("ops", 0, ["d-ops", "d-legal"]),
  ];

  it("luật đầu tiên khớp theo priority thắng (không theo thứ tự mảng)", () => {
    const r = pickProcess(rules, ["d-sales", "d-ops"]);
    expect(r).toEqual({ kind: "rule", rule: rules[2] as RoutingRule });
  });

  it("phòng ban con khớp luật chọn phòng cha (tập tổ tiên)", () => {
    // người ở d-sales-north (con của d-sales) ⇒ tập tổ tiên gồm d-sales
    const r = pickProcess(rules, ["d-sales-north", "d-sales", "d-root"]);
    expect(r.kind === "rule" && r.rule.id).toBe("sales");
  });

  it("không khớp ⇒ luật mặc định; luật mặc định không cạnh tranh theo điều kiện", () => {
    expect(pickProcess(rules, ["d-x"])).toEqual({ kind: "rule", rule: rules[0] as RoutingRule });
    expect(pickProcess(rules, [])).toEqual({ kind: "rule", rule: rules[0] as RoutingRule });
  });

  it("không khớp, không mặc định ⇒ none", () => {
    expect(pickProcess(rules.slice(1), ["d-x"])).toEqual({ kind: "none" });
    expect(pickProcess([], ["d-ops"])).toEqual({ kind: "none" });
  });

  it("luật thiếu departmentIds không khớp ai", () => {
    const r: RoutingRule = { id: "z", priority: 0, condition: {}, defId: "d", isDefault: false };
    expect(pickProcess([r], ["d-ops"])).toEqual({ kind: "none" });
    expect(pickProcess([r], ["d-ops"], { contractKind: "buy" })).toEqual({ kind: "none" });
  });
});

// cr118-route-kind · điều kiện loại HĐ (AND với phòng ban; rỗng/vắng = mọi giá trị; khe không có loại ⇒ bỏ qua).
describe("pickProcess · phòng ban × loại HĐ", () => {
  const kr = (
    id: string,
    priority: number,
    c: RoutingRule["condition"],
    isDefault = false,
  ): RoutingRule => ({ id, priority, condition: c, defId: `def-${id}`, isDefault });
  const rules = [
    kr("kd-mua", 0, { departmentIds: ["d-kd"], contractKinds: ["buy"] }),
    kr("kd-ban", 1, { departmentIds: ["d-kd"], contractKinds: ["sell", "referral"] }),
    kr("mua", 2, { contractKinds: ["buy"] }),
    kr("kd", 3, { departmentIds: ["d-kd"], contractKinds: [] }),
    kr("dflt", 4, {}, true),
  ];
  const pick = (depts: string[], kind?: string | null) =>
    ((r) => (r.kind === "rule" ? r.rule.id : "none"))(
      pickProcess(rules, depts, kind === undefined ? {} : { contractKind: kind }),
    );

  it("ma trận phòng ban × loại", () => {
    expect({
      kdBuy: pick(["d-kd"], "buy"),
      kdSell: pick(["d-kd"], "sell"),
      kdRef: pick(["d-kd"], "referral"),
      bgdBuy: pick(["d-bgd"], "buy"),
      bgdSell: pick(["d-bgd"], "sell"),
      kdNull: pick(["d-kd"], null),
      bgdNull: pick(["d-bgd"], null),
    }).toEqual({
      kdBuy: "kd-mua",
      kdSell: "kd-ban",
      kdRef: "kd-ban",
      bgdBuy: "mua",
      bgdSell: "dflt",
      kdNull: "kd",
      bgdNull: "dflt",
    });
  });

  it("thứ tự priority thắng khi nhiều luật cùng khớp", () => {
    const swapped = rules.map((r) => (r.id === "mua" ? { ...r, priority: -1 } : r));
    const r = pickProcess(swapped, ["d-kd"], { contractKind: "buy" });
    expect(r.kind === "rule" && r.rule.id).toBe("mua");
  });

  it("khe không cung cấp loại ⇒ bỏ qua điều kiện loại", () => {
    expect(pick(["d-kd"])).toBe("kd-mua");
    expect(pick(["d-bgd"])).toBe("mua");
    expect(pick([])).toBe("mua");
  });

  it("không khớp, không mặc định ⇒ none", () => {
    const r = pickProcess(rules.slice(0, 2), ["d-bgd"], { contractKind: "buy" });
    expect(r).toEqual({ kind: "none" });
  });
});
