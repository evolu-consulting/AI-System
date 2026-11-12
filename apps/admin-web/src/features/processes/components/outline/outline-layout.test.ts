// CR-127 · UI-FLOW · bố cục tự động của sơ đồ soạn quy trình: nhánh lồng, nhánh trống, chèn giữa, không đè nhau.
import { describe, expect, test } from "bun:test";
import {
  gapId,
  gapTestId,
  type LItem,
  type LNode,
  layoutOutline,
  SIZE,
  widthOf,
} from "./outline-layout";

const step = (id: string, after: number): LItem => ({ id, kind: "step", after });
const end = (id: string, after: number): LItem => ({ id, kind: "end", after });
const iff = (id: string, after: number, yes: LItem[], no: LItem[]): LItem => ({
  id,
  kind: "if",
  after,
  yes,
  no,
});
const by = (nodes: LNode[], id: string): LNode => {
  const n = nodes.find((x) => x.id === id);
  if (!n) throw new Error(`thiếu node ${id}`);
  return n;
};
const cx = (n: LNode) => n.x + n.w / 2;
const overlap = (a: LNode, b: LNode) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("layoutOutline · đường chính", () => {
  const l = layoutOutline([step("a", 1), step("b", 2), end("done", 3)], true);
  test("một cột giữa, từ trên xuống: Bắt đầu → + → a → + → b → + → Hoàn tất", () => {
    const order = ["start", gapId(null, 0), "a", gapId(null, 1), "b", gapId(null, 2), "done"];
    const ys = order.map((id) => by(l.nodes, id).y);
    expect([...ys].sort((p, q) => p - q)).toEqual(ys);
    for (const id of order) expect(cx(by(l.nodes, id))).toBe(0);
  });
  test("cạnh nối từng cặp liền kề; không có node nào đè nhau", () => {
    expect(l.edges.length).toBe(6);
    expect(l.edges.every((e) => e.kind === "line")).toBe(true);
    for (const a of l.nodes)
      for (const b of l.nodes) if (a !== b) expect(overlap(a, b)).toBe(false);
  });
  test("khối Hoàn tất cuối cùng không có nút + sau nó", () => {
    expect(l.nodes.filter((n) => n.type === "gap").map((n) => n.index)).toEqual([0, 1, 2]);
  });
  test("không có khối Bắt đầu ⇒ bắt đầu bằng nút +", () => {
    expect(layoutOutline([end("done", 1)], false).nodes[0]?.type).toBe("gap");
  });
});

describe("layoutOutline · chèn giữa", () => {
  test("chỉ số + sau cụm nhiều bước (Ký số) theo `after`", () => {
    const l = layoutOutline([step("sign", 2), step("n", 3), end("done", 4)], true);
    expect(by(l.nodes, gapId(null, 2)).index).toBe(2);
    expect(by(l.nodes, gapId(null, 0)).loc).toBeNull();
    expect(gapTestId(null, 0)).toBe("outline-add-main-0");
  });
});

describe("layoutOutline · Nếu", () => {
  const items = [
    step("a", 1),
    iff("q", 2, [step("y1", 1)], [step("n1", 1), step("n2", 2)]),
    step("z", 3),
    end("done", 4),
  ];
  const l = layoutOutline(items, true);
  test("hai cột cạnh nhau, Đúng bên trái Sai; khối Nếu và các khối sau nằm giữa", () => {
    const y1 = by(l.nodes, "y1");
    const n1 = by(l.nodes, "n1");
    expect(cx(y1)).toBeLessThan(0);
    expect(cx(n1)).toBeGreaterThan(0);
    expect(y1.y).toBe(n1.y);
    expect(cx(by(l.nodes, "q"))).toBe(0);
    expect(cx(by(l.nodes, "z"))).toBe(0);
    expect(by(l.nodes, "z").y).toBeGreaterThan(by(l.nodes, "n2").y + SIZE.stepH);
  });
  test("nhãn Đúng / Sai; + nằm trong từng nhánh với vị trí chèn riêng", () => {
    expect(by(l.nodes, "label:q:yes").side).toBe("yes");
    const g = by(l.nodes, gapId({ ifKey: "q", side: "no" }, 2));
    expect(g.loc).toEqual({ ifKey: "q", side: "no" });
    expect(gapTestId(g.loc ?? null, 2)).toBe("outline-add-q-no-2");
  });
  test("nhập lại: hai cạnh join cùng một điểm, cao bằng nhau; cạnh fork từ khối Nếu", () => {
    const joins = l.edges.filter((e) => e.kind === "join");
    expect(joins.length).toBe(2);
    expect(new Set(joins.map((e) => e.target)).size).toBe(1);
    const [t1, t2] = joins.map((e) => by(l.nodes, e.source));
    expect(t1?.y).toBe(t2?.y);
    expect(l.edges.filter((e) => e.kind === "fork").map((e) => e.source)).toEqual(["q", "q"]);
  });
  test("không node nào đè nhau", () => {
    for (const a of l.nodes)
      for (const b of l.nodes) if (a !== b) expect(overlap(a, b)).toBe(false);
  });
});

describe("layoutOutline · nhánh trống và lồng nhau", () => {
  test("nhánh trống: khung «đi tiếp» + một nút + ở vị trí 0", () => {
    const l = layoutOutline([iff("q", 1, [], []), end("done", 2)], false);
    expect(by(l.nodes, "empty:q:yes").type).toBe("empty");
    expect(by(l.nodes, gapId({ ifKey: "q", side: "yes" }, 0)).index).toBe(0);
    expect(by(l.nodes, "empty:q:no").y).toBe(by(l.nodes, "empty:q:yes").y);
  });
  test("Nếu lồng trong nhánh: cột rộng ra, không đè, cột chính vẫn ở giữa", () => {
    const inner = iff("in", 1, [step("i1", 1)], [step("i2", 1)]);
    const items = [iff("out", 1, [inner], [step("o1", 1)]), step("after", 2), end("done", 3)];
    const l = layoutOutline(items, true);
    expect(widthOf(items, 0)).toBeGreaterThan(SIZE.stepMain);
    for (const a of l.nodes)
      for (const b of l.nodes) if (a !== b) expect(overlap(a, b)).toBe(false);
    expect(cx(by(l.nodes, "after"))).toBe(0);
    expect(cx(by(l.nodes, "i1"))).toBeLessThan(cx(by(l.nodes, "i2")));
    expect(cx(by(l.nodes, "o1"))).toBeGreaterThan(cx(by(l.nodes, "i2")));
    expect(by(l.nodes, "after").y).toBeGreaterThan(by(l.nodes, "i1").y);
  });
  test("bố cục xác định: cùng đầu vào ⇒ cùng kết quả; khung bao gồm mọi node", () => {
    const items = [iff("q", 1, [step("a", 1)], []), end("done", 2)];
    expect(layoutOutline(items, true)).toEqual(layoutOutline(items, true));
    const { bounds, nodes } = layoutOutline(items, true);
    for (const n of nodes) {
      expect(n.x).toBeGreaterThanOrEqual(bounds.x);
      expect(n.y + n.h).toBeLessThanOrEqual(bounds.y + bounds.h);
    }
  });
});
