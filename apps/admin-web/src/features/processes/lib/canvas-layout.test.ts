// HUB-FR-104 · P-b2 (plan-frontend FB4/FB9): bố cục cột theo bước + cạnh tiến/quay lại + thả theo x.
import { describe, expect, test } from "bun:test";
import {
  COL_W,
  HEADER_H,
  headerId,
  joinId,
  layoutSteps,
  ROW_H,
  stepFromDropX,
} from "./canvas-layout";

const st = (uid: string, step: number, backTo: number[] = []) => ({
  uid,
  step,
  backTo,
  after: backTo.length ? ("review" as const) : ("auto" as const),
});

describe("layoutSteps", () => {
  const l = layoutSteps([st("a", 0), st("b", 1), st("c", 1), st("d", 2, [1])]);
  const at = (id: string) => l.nodes.find((n) => n.id === id);
  test("cột x = step × COL_W; header mỗi bước; số bước", () => {
    expect(l.steps).toBe(3);
    expect(at("c")).toMatchObject({ x: COL_W, y: HEADER_H + ROW_H });
    expect(at(headerId(2))).toMatchObject({ kind: "stepHeader", x: 2 * COL_W, y: 0, full: false });
  });
  test("cột thấp căn giữa theo cột cao nhất", () => {
    expect(at("a")?.y).toBe(HEADER_H + ROW_H / 2);
  });
  test("join chỉ giữa cột đông và cột kế", () => {
    expect(at(joinId(1))).toMatchObject({ kind: "join", count: 2 });
    expect(at(joinId(0))).toBeUndefined();
    expect(at(joinId(2))).toBeUndefined();
  });
  test("cạnh tiến qua join; cạnh quay lại tới header bước đích", () => {
    const ids = l.edges.map((e) => `${e.kind}:${e.source}>${e.target}`);
    expect(ids).toContain("forward:a>b");
    expect(ids).toContain("forward:a>c");
    expect(ids).toContain("forward:b>j1");
    expect(ids).toContain("forward:j1>d");
    expect(ids).toContain("back:d>h1");
  });
  test("rỗng ⇒ không node; đích quay lại không hợp lệ bị bỏ", () => {
    expect(layoutSteps([])).toEqual({ nodes: [], edges: [], steps: 0 });
    expect(layoutSteps([st("a", 0, [0, 5])]).edges.filter((e) => e.kind === "back")).toEqual([]);
  });
  test("bước đủ 3 ⇒ header full", () => {
    const f = layoutSteps([st("a", 0), st("b", 0), st("c", 0)]);
    expect(f.nodes.find((n) => n.id === "h0")).toMatchObject({ full: true });
  });
});

describe("stepFromDropX", () => {
  test("cột gần nhất, kẹp 0…steps (steps = bước mới)", () => {
    expect(stepFromDropX(COL_W * 1.4, 3)).toBe(1);
    expect(stepFromDropX(COL_W * 1.6, 3)).toBe(2);
    expect(stepFromDropX(-500, 3)).toBe(0);
    expect(stepFromDropX(COL_W * 9, 3)).toBe(3);
  });
});
