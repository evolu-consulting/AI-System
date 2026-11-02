import { describe, expect, test } from "bun:test";
import type { CurrentStep } from "./current-flow";
import { buildFlowCanvas, type CondLabels, conditionLabel, GAP_Y } from "./flow-canvas";

const L: CondLabels = {
  value: "Giá trị",
  deal: "Loại HĐ",
  dealNames: { buy: "Mua", sell: "Bán", referral: "Giới thiệu" },
  and: "và",
  or: "hoặc",
  number: (n) => String(n),
};
const step = (key: string, extra: Partial<CurrentStep> = {}): CurrentStep => ({
  key,
  name: `Bước ${key}`,
  department: null,
  kind: "review",
  when: null,
  ...extra,
});
const GD = step("s1", {
  name: "Giám đốc",
  department: "Ban giám đốc",
  when: { op: "and", conds: [{ field: "total_value", op: "ge", value: 100 }] },
});
const STEPS = [step("s0", { department: "Kinh doanh" }), GD, step("s2", { kind: "esign" })];

describe("flow-canvas · buildFlowCanvas", () => {
  const { nodes, edges } = buildFlowCanvas(STEPS, L);
  test("thứ tự: Bắt đầu → các bước → Ghi Đã duyệt (khoá), nối tuần tự", () => {
    expect(nodes.map((n) => n.id)).toEqual(["start", "s0", "s1", "s2", "finalize"]);
    expect(nodes.at(-1)?.data.locked).toBe(true);
    expect(nodes.slice(0, -1).every((n) => !n.data.locked)).toBe(true);
    expect(edges.map((e) => [e.source, e.target])).toEqual([
      ["start", "s0"],
      ["s0", "s1"],
      ["s1", "s2"],
      ["s2", "finalize"],
    ]);
  });
  test("bố cục dọc, cách đều GAP_Y, node không kéo/nối/xoá được", () => {
    for (let i = 1; i < nodes.length; i++) {
      const a = nodes[i - 1];
      const b = nodes[i];
      expect(b?.position.y).toBe((a?.position.y ?? 0) + (a?.height ?? 0) + GAP_Y);
      expect(b?.position.x).toBe(0);
    }
    expect(nodes.every((n) => n.draggable === false && n.connectable === false)).toBe(true);
    expect(nodes.every((n) => n.deletable === false)).toBe(true);
  });
  test("nhãn điều kiện + huy hiệu: Có điều kiện / Ký số, phòng ban chỉ hiện khi khác tên bước", () => {
    const gd = nodes.find((n) => n.id === "s1")?.data;
    expect(gd?.condition).toBe("Giá trị ≥ 100");
    expect(gd?.badges).toEqual(["conditional"]);
    expect(gd?.department).toBe("Ban giám đốc");
    expect(nodes.find((n) => n.id === "s2")?.data.badges).toEqual(["esign"]);
    expect(nodes.find((n) => n.id === "s0")?.data.condition).toBeNull();
  });
  test("run từ xem trước: bước bị bỏ qua ⇒ dim, cạnh vào bước đó mờ", () => {
    const r = buildFlowCanvas(STEPS, L, [true, false, true]);
    expect(r.nodes.map((n) => n.data.dim)).toEqual([false, false, true, false, false]);
    expect(r.edges.find((e) => e.target === "s1")?.style?.opacity).toBe(0.35);
    expect(r.edges.find((e) => e.target === "s2")?.style).toBeUndefined();
  });
});

describe("flow-canvas · conditionLabel", () => {
  test("loại HĐ + giá trị nối bằng và/hoặc; không điều kiện ⇒ null", () => {
    expect(
      conditionLabel(
        {
          op: "or",
          conds: [
            { field: "deal", in: ["buy", "sell"] },
            { field: "total_value", op: "lt", value: 5 },
          ],
        },
        L,
      ),
    ).toBe("Loại HĐ: Mua, Bán hoặc Giá trị < 5");
    expect(conditionLabel(null, L)).toBeNull();
  });
});
