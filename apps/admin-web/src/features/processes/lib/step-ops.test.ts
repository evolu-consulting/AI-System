// HUB-FR-104 · P-b2 (plan-frontend FB6): phép đổi bước thuần — bất biến sau mỗi phép + lỗi đầy bước/tối đa stage.
import { describe, expect, test } from "bun:test";
import {
  addStageAsNewStep,
  addStageToStep,
  columnNeighbor,
  insertStepAfter,
  moveInColumn,
  moveToStep,
  normalizeSteps,
  removeStage,
  type Stepped,
  splitToNewStep,
} from "./step-ops";

const mk = (uid: string, step: number, extra: Partial<Stepped> = {}): Stepped => ({
  uid,
  step,
  backTo: [],
  after: "auto",
  ...extra,
});
const view = (l: readonly Stepped[]) => l.map((s) => `${s.uid}@${s.step}`);
const ok = <T>(r: { stages: T[] } | { error: string }): T[] => {
  if (!("stages" in r)) throw new Error(`lỗi: ${r.error}`);
  return r.stages;
};
/** A@0 | B@1 C@1 | D@2 */
const base = (): Stepped[] => [
  mk("A", 0),
  mk("B", 1),
  mk("C", 1),
  mk("D", 2, { after: "review", backTo: [0, 1] }),
];

describe("normalizeSteps", () => {
  test("nén bước trống, sắp ổn định, remap backTo, bỏ đích không hợp lệ", () => {
    const out = normalizeSteps([
      mk("A", 0),
      mk("C", 4, { after: "review", backTo: [0, 2, 4, 9] }),
      mk("B", 2),
    ]);
    expect(view(out)).toEqual(["A@0", "B@1", "C@2"]);
    expect(out[2]?.backTo).toEqual([0, 1]);
  });
  test("after=auto ⇒ backTo rỗng", () => {
    expect(normalizeSteps([mk("A", 0), mk("B", 1, { backTo: [0] })])[1]?.backTo).toEqual([]);
  });
});

describe("moveToStep", () => {
  test("sang cột có sẵn: vào đầu cột, bước trống được nén, backTo remap", () => {
    const out = ok(moveToStep(base(), 3, 1));
    expect(view(out)).toEqual(["A@0", "D@1", "B@1", "C@1"]);
    expect(out[1]?.backTo).toEqual([0]);
  });
  test("cột đích đầy (3) ⇒ lỗi stepFull kèm bước, không đổi", () => {
    const four = [mk("X", 0), mk("A", 1), mk("B", 1), mk("C", 1)];
    expect(moveToStep(four, 0, 1)).toEqual({ error: "process.admin.canvas.err.stepFull", step: 1 });
  });
  test("quá cuối ⇒ bước mới cuối; âm ⇒ bước 0; cùng bước ⇒ không đổi", () => {
    expect(view(ok(moveToStep(base(), 0, 99)))).toEqual(["B@0", "C@0", "D@1", "A@2"]);
    expect(view(ok(moveToStep(base(), 3, -5)))).toEqual(["D@0", "A@0", "B@1", "C@1"]);
    expect(view(ok(moveToStep(base(), 1, 1)))).toEqual(view(base()));
  });
  test("chuyển ra khỏi cột còn người ở lại ⇒ bước đó không bị nén", () => {
    expect(view(ok(moveToStep(base(), 1, 2)))).toEqual(["A@0", "C@1", "B@2", "D@2"]);
  });
});

describe("splitToNewStep / moveInColumn", () => {
  test("tách khỏi cột đông ⇒ bước riêng ngay sau cột; đứng riêng ⇒ không đổi", () => {
    expect(view(ok(splitToNewStep(base(), 1)))).toEqual(["A@0", "C@1", "B@2", "D@3"]);
    expect(view(ok(splitToNewStep(base(), 0)))).toEqual(view(base()));
  });
  test("tách giữ backTo hợp lệ (remap)", () => {
    expect(ok(splitToNewStep(base(), 1))[3]?.backTo).toEqual([0, 1]);
  });
  test("đổi chỗ trong cột; hết cột ⇒ không đổi", () => {
    expect(view(moveInColumn(base(), 1, 1))).toEqual(["A@0", "C@1", "B@1", "D@2"]);
    expect(view(moveInColumn(base(), 1, -1))).toEqual(view(base()));
    expect(columnNeighbor(base(), 1, -1)).toBe(-1);
    expect(columnNeighbor(base(), 1, 1)).toBe(2);
  });
});

describe("addStageToStep / addStageAsNewStep / removeStage", () => {
  test("thêm vào cuối cột; đầy ⇒ lỗi; bước mới ở cuối", () => {
    const out = ok(addStageToStep(base(), 1, mk("N", 9)));
    expect(view(out)).toEqual(["A@0", "B@1", "C@1", "N@1", "D@2"]);
    expect(addStageToStep(out, 1, mk("M", 0))).toEqual({
      error: "process.admin.canvas.err.stepFull",
      step: 1,
    });
    expect(view(ok(addStageAsNewStep(base(), mk("N", 0))))).toEqual([
      "A@0",
      "B@1",
      "C@1",
      "D@2",
      "N@3",
    ]);
  });
  test("chèn bước mới sau bước k; backTo trỏ bước sau được remap", () => {
    const out = ok(insertStepAfter(base(), 0, mk("N", 0)));
    expect(view(out)).toEqual(["A@0", "N@1", "B@2", "C@2", "D@3"]);
    expect(out[4]?.backTo).toEqual([0, 2]);
    expect(view(ok(insertStepAfter([], -1, mk("N", 0))))).toEqual(["N@0"]);
  });
  test("tối đa 10 giai đoạn", () => {
    const ten = Array.from({ length: 10 }, (_, i) => mk(`s${i}`, i));
    expect(addStageAsNewStep(ten, mk("x", 0))).toEqual({
      error: "process.admin.canvas.err.stagesMax",
    });
  });
  test("xoá cả cột ⇒ nén + bỏ backTo trỏ cột đó", () => {
    const out = removeStage(base(), 0);
    expect(view(out)).toEqual(["B@0", "C@0", "D@1"]);
    expect(out[2]?.backTo).toEqual([0]);
    expect(removeStage(base(), 1).length).toBe(3);
  });
});
