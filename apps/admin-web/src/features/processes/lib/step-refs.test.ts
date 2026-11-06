import { describe, expect, test } from "bun:test";
import { emptyStage } from "./def-form";
import { insertStepAfter, removeStage } from "./step-ops";
import { remapStepRefs } from "./step-refs";

const st = (uid: string, step: number, o: object = {}) => ({ ...emptyStage(step), uid, ...o });

describe("step-refs", () => {
  // 0: duyệt (reject→2, ret→2, next→2) · 1: gửi · 2: kết thúc
  const base = () => [
    st("a", 0, {
      approve: { reject: 2, ret: 2 },
      nextStep: 2,
      branch: [{ field: "x", op: "eq", value: "1", goto: 3 }],
      ifx: { op: "and", conds: [], yes: 3, no: null },
      wait: { source: "", offset: "0", time: "09:00", branches: [{ on: "timeout", step: 2 }] },
    }),
    st("b", 1),
    st("c", 2),
  ];

  test("chèn bước ở giữa ⇒ mọi đích tới bước sau đó dời +1, đích trước đó giữ", () => {
    const before = base();
    const res = insertStepAfter(before, 0, st("n", 99));
    if (!("stages" in res)) throw new Error("chèn lỗi");
    const out = remapStepRefs(before, res.stages);
    const a = out.find((s) => s.uid === "a");
    expect(a?.approve).toEqual({ reject: 3, ret: 3 });
    expect(a?.nextStep).toBe(3);
    expect(a?.branch[0]?.goto).toBe(4);
    expect(a?.ifx.yes).toBe(4);
    expect(a?.wait.branches?.[0]?.step).toBe(3);
  });

  test("xoá bước đích ⇒ đích về chưa chọn (không trỏ sai)", () => {
    const before = base();
    const out = remapStepRefs(before, removeStage(before, 2));
    const a = out.find((s) => s.uid === "a");
    expect(a?.approve).toEqual({ reject: null, ret: null });
    expect(a?.nextStep).toBeUndefined();
    expect(a?.branch[0]?.goto).toBeNull();
    expect(a?.wait.branches?.[0]?.step).toBeNull();
  });

  test("không đổi bước ⇒ giữ nguyên mảng", () => {
    const before = base();
    expect(remapStepRefs(before, before)).toBe(before);
  });
});
