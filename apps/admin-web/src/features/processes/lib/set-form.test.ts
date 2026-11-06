import { describe, expect, test } from "bun:test";
import type { SetExecutor } from "@ai/contracts/hub-admin";
import { emptyStage } from "./def-form";
import { setFromDef, setToDef } from "./set-form";
import { insertStepAfter } from "./step-ops";
import { remapStepRefs } from "./step-refs";

const ex: SetExecutor = {
  kind: "set",
  values: [
    { key: "a", from: { input: "x-in" } },
    { key: "b", from: { const: "7" }, as: "number" },
    { key: "c", from: { kind: "field", step: 1, key: "ngay" }, as: "date" },
    { key: "d", from: { kind: "fact", key: "total_value" } },
  ],
};

describe("set-form · nguồn field/dữ kiện + kiểu ghi (E4)", () => {
  test("def → draft → def giữ nguyên từng nguồn và `as`", () => {
    const back = setToDef(setFromDef(ex));
    expect(back.values).toEqual([
      { key: "a", from: { input: "x-in" } },
      { key: "b", from: { const: 7 }, as: "number" },
      { key: "c", from: { kind: "field", step: 1, key: "ngay" }, as: "date" },
      { key: "d", from: { kind: "fact", key: "total_value" } },
    ]);
  });
  test("chưa chọn đủ nguồn ⇒ dòng bị bỏ", () => {
    const d = setFromDef({ kind: "set", values: [{ key: "c", from: { kind: "fact", key: "k" } }] });
    const row = d.rows[0];
    if (!row) throw new Error("thiếu dòng");
    expect(setToDef({ rows: [{ ...row, ref: "" }] }).values).toEqual([]);
  });
  test("chèn bước giữa ⇒ `step` của nguồn field dời theo", () => {
    const before = [
      { ...emptyStage(0), uid: "a" },
      { ...emptyStage(1), uid: "b" },
      { ...emptyStage(2), uid: "c", set: setFromDef(ex) },
    ];
    const res = insertStepAfter(before, 0, { ...emptyStage(99), uid: "n" });
    if (!("stages" in res)) throw new Error("chèn lỗi");
    const out = remapStepRefs(before, res.stages).find((s) => s.uid === "c");
    expect(out?.set.rows[2]?.step).toBe(2);
  });
});
