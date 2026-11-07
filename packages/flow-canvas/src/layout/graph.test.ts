// CR-123 · u13 · đồ thị bước (cạnh) — nguồn duy nhất cho cạnh sơ đồ; vị trí do ELK (`elk.test.ts`).
import { describe, expect, test } from "bun:test";
import { type GraphStage, stepCount, stepEdges } from "./graph";

const st = (uid: string, step: number, o: Partial<GraphStage> = {}): GraphStage => ({
  uid,
  step,
  backTo: [],
  after: "auto",
  ...o,
});

describe("stepEdges", () => {
  test("cạnh tiến: mỗi stage của cột k nối tới mọi stage của cột k+1 (không có nút gộp)", () => {
    const e = stepEdges([st("a", 0), st("b", 1), st("c", 1), st("d", 2)]);
    expect(e.map((x) => x.id)).toEqual(["a>b", "a>c", "b>d", "c>d"]);
    expect(e.every((x) => x.kind === "forward")).toBe(true);
  });

  test("bước Kết thúc không có cạnh đi tiếp", () => {
    const e = stepEdges([
      st("a", 0),
      st("f", 1, { terminal: true }),
      st("g", 2, { terminal: true }),
    ]);
    expect(e.map((x) => x.id)).toEqual(["a>f"]);
  });

  test("node Nếu: đúng hai cạnh Đúng/Sai tới stage đầu của bước đích, Sai vắng ⇒ bước kế, không có cạnh tiến", () => {
    const e = stepEdges([st("i", 0, { ifs: { yes: 2, no: null } }), st("n", 1), st("y", 2)]);
    const mine = e.filter((x) => x.source === "i");
    expect(mine.map((x) => [x.target, x.side, x.kind])).toEqual([
      ["y", "yes", "branch"],
      ["n", "no", "branch"],
    ]);
  });

  test("đích Nếu không hợp lệ (≤ bước Nếu / không có) ⇒ bỏ cạnh đó", () => {
    const e = stepEdges([st("i", 1, { ifs: { yes: 0, no: 9 } }), st("a", 0)]);
    expect(e.filter((x) => x.source === "i")).toEqual([]);
  });

  test("luật rẽ nhánh và cạnh quay lại tới stage đầu của cột đích; back:false bỏ cạnh quay lại", () => {
    const stages = [
      st("a", 0),
      st("b", 1, { branch: [2, null, 0] }),
      st("c", 2, { after: "review", backTo: [0, 5] }),
    ];
    const e = stepEdges(stages);
    expect(e.filter((x) => x.kind === "branch").map((x) => [x.target, x.rule])).toEqual([["c", 1]]);
    expect(e.filter((x) => x.kind === "back").map((x) => x.target)).toEqual(["a"]);
    expect(stepEdges(stages, { back: false }).some((x) => x.kind === "back")).toBe(false);
  });

  test("stepCount", () => {
    expect(stepCount([])).toBe(0);
    expect(stepCount([st("a", 0), st("b", 3)])).toBe(4);
  });
});
