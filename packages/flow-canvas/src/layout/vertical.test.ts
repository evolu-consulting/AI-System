import { describe, expect, test } from "bun:test";
import {
  buildFlowCanvas,
  buildVerticalGraph,
  type CondLabels,
  conditionLabel,
  GAP_Y,
  type VerticalStepInput,
} from "./vertical";

const L: CondLabels = {
  value: "Giá trị",
  deal: "Loại HĐ",
  dealNames: { buy: "Mua", sell: "Bán", referral: "Giới thiệu" },
  and: "và",
  or: "hoặc",
  number: (n) => String(n),
  skip: "Không thoả ⇒ bỏ qua",
};
const step = (key: string, extra: Partial<VerticalStepInput> = {}): VerticalStepInput => ({
  key,
  name: `Bước ${key}`,
  department: null,
  kind: "review",
  when: null,
  dueH: null,
  remindH: null,
  escalateGroup: null,
  approverCount: null,
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
    // 4 cạnh chính + 1 nhánh bỏ qua của bước có điều kiện (s1)
    expect(edges.filter((e) => !e.id.startsWith("skip-")).map((e) => [e.source, e.target])).toEqual(
      [
        ["start", "s0"],
        ["s0", "s1"],
        ["s1", "s2"],
        ["s2", "finalize"],
      ],
    );
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
    expect(r.edges.find((e) => e.id === "e-s0-s1")?.style?.opacity).toBe(0.35);
    expect(r.edges.find((e) => e.id === "e-s1-s2")?.style).toBeUndefined();
  });
  test('nhánh bỏ qua (CR-108): bước có điều kiện (không phải bước đầu) ⇒ cạnh nét đứt từ node liền trước sang node liền sau, nhãn "Không thoả ⇒ bỏ qua"', () => {
    const skips = edges.filter((e) => e.id.startsWith("skip-"));
    expect(skips.map((e) => [e.id, e.source, e.target, e.label])).toEqual([
      ["skip-s1", "s0", "s2", "Không thoả ⇒ bỏ qua"],
    ]);
    expect(skips[0]?.style?.strokeDasharray).toBeTruthy();
    expect(skips[0]?.sourceHandle).toBe("skip-out");
    expect(skips[0]?.targetHandle).toBe("skip-in");
  });
  test("CR-108 cạnh chính vào bước điều kiện mang nhãn điều kiện; cạnh khác không nhãn", () => {
    expect(edges.find((e) => e.id === "e-s0-s1")?.label).toBe("Giá trị ≥ 100");
    expect(edges.find((e) => e.id === "e-s1-s2")?.label).toBeUndefined();
    expect(edges.find((e) => e.id === "e-start-s0")?.label).toBeUndefined();
  });
  test("CR-108 nhánh bỏ qua sáng lên khi bước bị bỏ qua theo xem trước, mờ khi bước chạy", () => {
    const on = buildFlowCanvas(STEPS, L, [true, false, true]).edges.find((e) => e.id === "skip-s1");
    const off = buildFlowCanvas(STEPS, L, [true, true, true]).edges.find((e) => e.id === "skip-s1");
    expect([on?.style?.opacity, off?.style?.opacity]).toEqual([1, 0.5]);
  });
  test("CR-108 bước cuối có điều kiện vẫn có nhánh bỏ qua sang Ghi Đã duyệt; bước không điều kiện thì không", () => {
    const r = buildFlowCanvas([step("a"), step("b", { when: GD.when })], L);
    expect(
      r.edges.filter((e) => e.id.startsWith("skip-")).map((e) => [e.source, e.target]),
    ).toEqual([["a", "finalize"]]);
    expect(
      buildFlowCanvas([step("a"), step("b")], L).edges.some((e) => e.id.startsWith("skip-")),
    ).toBe(false);
  });
  test("chiều cao node theo số dòng thông tin (chuyển cấp / cảnh báo thiếu nhóm): hạn/nhắc/người duyệt/chuyển cấp có ⇒ node cao thêm từng dòng; vắng ⇒ ẩn", () => {
    const plain = buildFlowCanvas([step("a")], L).nodes[1];
    const full = buildFlowCanvas(
      [step("a", { dueH: 24, remindH: 8, approverCount: 3, escalateGroup: "Ban giám đốc" })],
      L,
    ).nodes[1];
    expect(full?.data.info).toEqual({
      dueH: 24,
      remindH: 8,
      approvers: 3,
      escalate: "Ban giám đốc",
    });
    expect((full?.height ?? 0) - (plain?.height ?? 0)).toBe(3 * 22);
    // nhắc không có hạn ⇒ không hiện nhắc; số người duyệt 0 vẫn hiện (khác "không biết")
    const odd = buildFlowCanvas([step("a", { remindH: 8, approverCount: 0 })], L).nodes[1];
    expect(odd?.data.info).toEqual({ dueH: null, remindH: null, approvers: 0, escalate: null });
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

describe("flow-canvas · buildVerticalGraph", () => {
  test("dòng bước đã gắn nhãn điều kiện (host tự ghép chữ) vẫn dựng đúng nhánh bỏ qua", () => {
    const { when: _w, ...a } = step("a");
    const { when: _x, ...b } = step("b");
    const r = buildVerticalGraph(
      [
        { ...a, condition: null },
        { ...b, condition: "Chỉ khi giá trị > 500 tr" },
      ],
      "bỏ qua",
    );
    expect(r.nodes.map((n) => n.id)).toEqual(["start", "a", "b", "finalize"]);
    expect(r.edges.find((e) => e.id === "e-a-b")?.label).toBe("Chỉ khi giá trị > 500 tr");
    expect(
      r.edges.filter((e) => e.id.startsWith("skip-")).map((e) => [e.source, e.target]),
    ).toEqual([["a", "finalize"]]);
  });
  test("snapshot toạ độ: cột dọc x = 0, y cộng dồn chiều cao + GAP_Y (giữ như bản sohoptac-web cũ)", () => {
    const { nodes } = buildFlowCanvas(STEPS, L);
    expect(nodes.map((n) => [n.id, n.position.x, n.position.y, n.width, n.height])).toEqual([
      ["start", 0, 0, 280, 40],
      ["s0", 0, 92, 280, 64],
      ["s1", 0, 208, 280, 92],
      ["s2", 0, 352, 280, 70],
      ["finalize", 0, 474, 280, 52],
    ]);
  });
});
