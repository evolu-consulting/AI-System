// CR-122 · P8: chèn bước vào giữa một cạnh — đích (goto/next_step/Nếu) vẫn đúng sau khi chèn.
import { describe, expect, test } from "bun:test";
import { emptyStage } from "./def-form";
import { insertOnEdge } from "./insert-on-edge";

const st = (uid: string, step: number, o: object = {}) => ({ ...emptyStage(step), uid, ...o });
const ok = <T>(r: { stages: T[] } | { error: string }): T[] => {
  if (!("stages" in r)) throw new Error(r.error);
  return r.stages;
};

describe("insertOnEdge", () => {
  test("chèn giữa hai bước tuần tự ⇒ bước sau dời xuống, đích cũ đánh lại", () => {
    // a(0, next→2 = c, goto→3 = d) · b(1) · c(2) · d(3)
    const before = [
      st("a", 0, {
        nextStep: 2,
        branch: [{ field: "x", op: "eq", value: "1", goto: 4 }], // đếm từ 1 ⇒ bước d
      }),
      st("b", 1),
      st("c", 2),
      st("d", 3),
    ];
    const out = ok(insertOnEdge(before, st("n", 99), { from: "b", to: "c" }));
    expect(out.map((s) => [s.uid, s.step])).toEqual([
      ["a", 0],
      ["b", 1],
      ["n", 2],
      ["c", 3],
      ["d", 4],
    ]);
    const a = out.find((s) => s.uid === "a");
    expect(a?.nextStep).toBe(3); // vẫn tới c
    expect(a?.branch[0]?.goto).toBe(5); // vẫn tới d (đếm từ 1)
    expect(out.find((s) => s.uid === "n")?.nextStep).toBeUndefined(); // đi tuần tự sang c
  });

  test("chèn trên nhánh Đúng của Nếu ⇒ bước mới nằm trên nhánh Đúng, nhánh Sai giữ đích", () => {
    // i(0): Đúng→t (bước 1, yes=2) · Sai→f (bước 2, no=3)
    const before = [
      st("i", 0, { ifx: { op: "and", conds: [], yes: 2, no: 3 } }),
      st("t", 1),
      st("f", 2),
    ];
    const out = ok(insertOnEdge(before, st("n", 99), { from: "i", to: "t", side: "yes" }));
    const i = out.find((s) => s.uid === "i");
    const n = out.find((s) => s.uid === "n");
    const t = out.find((s) => s.uid === "t");
    const f = out.find((s) => s.uid === "f");
    expect(n?.step).toBe(1);
    expect(i?.ifx.yes).toBe((n?.step ?? 0) + 1); // Đúng → bước mới
    expect(n?.nextStep).toBe(t?.step); // bước mới đi tiếp tới đích cũ của Đúng
    expect(i?.ifx.no).toBe((f?.step ?? 0) + 1); // Sai vẫn tới f
    expect(f?.step).toBe(3);
  });

  test("nguồn có next_step tường minh tới đích ⇒ next_step trỏ bước mới, bước mới đi tiếp tới đích", () => {
    const before = [st("a", 0, { nextStep: 2 }), st("b", 1), st("c", 2)];
    const out = ok(insertOnEdge(before, st("n", 99), { from: "a", to: "c" }));
    const a = out.find((s) => s.uid === "a");
    const n = out.find((s) => s.uid === "n");
    const c = out.find((s) => s.uid === "c");
    expect(a?.nextStep).toBe(n?.step);
    expect(n?.nextStep).toBe(c?.step);
  });
});
