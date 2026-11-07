// CR-123 · p25 · cạnh nhảy bước: "đi tiếp" khác bước kế ⇒ vẽ cạnh tới đúng bước đó, bỏ cạnh tới bước kế.
import { describe, expect, test } from "bun:test";
import type { LayoutEdge } from "@ai/flow-canvas/pure";
import { applyJumps, type JumpStage } from "./jump-edges";

const s = (uid: string, step: number, o: Partial<JumpStage> = {}): JumpStage => ({
  uid,
  step,
  isIf: false,
  nextStep: undefined,
  terminal: false,
  ...o,
});
const fwd = (a: string, b: string): LayoutEdge => ({
  id: `${a}>${b}`,
  source: a,
  target: b,
  kind: "forward",
});

describe("applyJumps", () => {
  const stages = [s("a", 0, { nextStep: 2 }), s("b", 1), s("c", 2)];
  const edges = [fwd("a", "b"), fwd("b", "c")];

  test("a đi tiếp tới bước 2 ⇒ cạnh a→c thay a→b", () => {
    expect(applyJumps(stages, edges).map((e) => e.id)).toEqual(["b>c", "a>c"]);
  });
  test("đích là bước kế, node Nếu, bước kết thúc ⇒ giữ nguyên", () => {
    expect(applyJumps([s("a", 0, { nextStep: 1 }), s("b", 1)], [fwd("a", "b")])).toEqual([
      fwd("a", "b"),
    ]);
    expect(
      applyJumps([s("a", 0, { nextStep: 2, isIf: true }), s("b", 1), s("c", 2)], edges),
    ).toEqual(edges);
    expect(
      applyJumps([s("a", 0, { nextStep: 2, terminal: true }), s("b", 1), s("c", 2)], edges),
    ).toEqual(edges);
  });
  test("bước nằm trong cột song song ⇒ không vẽ nhảy (đi qua nút gộp)", () => {
    const par = [s("a", 0, { nextStep: 2 }), s("a2", 0), s("b", 1), s("c", 2)];
    expect(applyJumps(par, edges)).toEqual(edges);
  });
});
