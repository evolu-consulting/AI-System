// HUB-FR-129 · PC2-R01 · P-c2 F2: stage "Áp bản sửa" — ép giá trị, luật chéo APPLY_*, body gửi Hub.
import { describe, expect, test } from "bun:test";
import { APPLY_PATCH, applyCrossErrors, normalizeApply } from "./apply-form";
import {
  emptyDraft,
  emptyStage,
  patchStage,
  type StageDraft,
  toInput,
  validateDraft,
} from "./def-form";

const fix = (): StageDraft => ({
  ...emptyStage(0),
  key: "sua",
  name: "Sửa",
  filename: "fix.md",
  template: "## Diff",
  sections: ["Diff"],
  executor: "agent:a1",
  after: "review",
  autofix: { on: true, source: "repo", install: "", test: "bun test", allow: "" },
});
const apply = (step: number, key = "ap"): StageDraft => ({
  ...emptyStage(step),
  ...APPLY_PATCH,
  key,
  name: key,
  filename: "apply.md",
  template: "## Kết quả áp\n",
  sections: ["Kết quả áp"],
});

describe("apply-form", () => {
  test("chọn Áp ⇒ real bật, after auto", () => {
    const [s] = patchStage([fix()], 0, APPLY_PATCH);
    expect(s?.executor).toBe("apply");
    expect(s?.real).toBe(true);
    expect(s?.after).toBe("auto");
  });
  test("Áp sau stage tự sửa ⇒ không lỗi; thiếu tự sửa ⇒ APPLY_NO_AUTOFIX; hai Áp ⇒ APPLY_MAX", () => {
    expect(applyCrossErrors([fix(), apply(1)])).toEqual({});
    expect(applyCrossErrors([apply(0)])["stages.0.executor"]).toBe(
      "process.admin.apply.err.APPLY_NO_AUTOFIX",
    );
    const e = applyCrossErrors([fix(), apply(1, "a1"), apply(2, "a2")]);
    expect(e["stages.2.executor"]).toBe("process.admin.apply.err.APPLY_NO_AUTOFIX");
    expect(
      applyCrossErrors([fix(), apply(1, "a1"), { ...apply(1, "a2") }])["stages.2.executor"],
    ).toBe("process.admin.apply.err.APPLY_MAX");
  });
  test("normalizeApply bỏ ô ẩn; toInput gửi executor apply, real true, after auto, nguồn/ngân sách trống", () => {
    const s = { ...apply(1), instruction: "x", budget: "5", mustKnow: "a", real: false };
    expect(normalizeApply(s).budget).toBe("");
    const d = {
      ...emptyDraft(),
      key: "quy-trinh-ap",
      name: "N",
      sources: ["repo"],
      stages: [fix(), s],
    };
    const st = toInput(d).stages[1];
    expect(st?.executor).toEqual({ kind: "apply" });
    expect(st?.real_action).toBe(true);
    expect(st?.after).toEqual({ kind: "auto" });
    expect(st?.token_budget).toBeNull();
    expect(st?.must_know).toEqual([]);
    expect(st?.instruction).toBe("");
    expect(validateDraft(d)).toEqual({});
  });
});
