// HUB-FR-104 · HUB-BR-38 · HUB-FR-136 · AC-PB2-04/05/09 · test-plan-cases §3.1 `process-steps` (RD-01…RD-18, RH-01…RH-03):
// hàm thuần contract `@ai/contracts/hub-admin` (plan §1.2): `resolveSteps`, `stepGroups`, `processDefStageIssues`,
// `processDefStagePaths`, `clipHandoff`, `handoffTokens`. Export vắng ⇒ đỏ ở `fn(...)`.
import { describe, expect, it } from "bun:test";
import { fn, loadHubAdmin } from "../_support/_modules";
import { type Json, st, stepsOnly } from "../_support/stages";

const h = await loadHubAdmin();
const issues = (stages: Json[]) =>
  fn(h, "processDefStageIssues")(stages) as { path: string; rule: string }[];
const I = (path: string, rule: string) => ({ path, rule });

describe("RD · bước của def [HUB-FR-104][HUB-BR-38]", () => {
  it("HUB-FR-104 · RD-01 · 4 stage không `step` ⇒ resolveSteps [0,1,2,3], stepGroups [[0],[1],[2],[3]]", () => {
    const s = stepsOnly([undefined, undefined, undefined, undefined]);
    expect(fn(h, "resolveSteps")(s)).toEqual([0, 1, 2, 3]);
    expect(fn(h, "stepGroups")(s)).toEqual([[0], [1], [2], [3]]);
  });
  it("HUB-FR-104 · RD-02 · step [0,1,1,2] ⇒ stepGroups [[0],[1,2],[3]]", () => {
    expect(fn(h, "stepGroups")(stepsOnly([0, 1, 1, 2]))).toEqual([[0], [1, 2], [3]]);
    expect(fn(h, "resolveSteps")(stepsOnly([0, 1, 1, 2]))).toEqual([0, 1, 1, 2]);
  });
  it("AC-PB2-04 · RD-03 · step [0,1,1,1,1] ⇒ chỉ stage thứ 4 của bước 1 bị STEP_TOO_WIDE (stages.4.step)", () => {
    expect(issues(stepsOnly([0, 1, 1, 1, 1]))).toEqual([I("stages.4.step", "STEP_TOO_WIDE")]);
  });
  it("AC-PB2-04 · RD-04 · step [0,0,0,0,0,1] ⇒ STEP_TOO_WIDE ở stages.3.step và stages.4.step", () => {
    expect(issues(stepsOnly([0, 0, 0, 0, 0, 1]))).toEqual([
      I("stages.3.step", "STEP_TOO_WIDE"),
      I("stages.4.step", "STEP_TOO_WIDE"),
    ]);
  });
  it("AC-PB2-04 · RD-05 · `step` có ở stage 0, 2 — thiếu ở 1, 3 ⇒ STEP_INCOMPLETE ở MỌI stage thiếu", () => {
    const got = issues(stepsOnly([0, undefined, 1, undefined]));
    expect(got.filter((x) => x.rule === "STEP_INCOMPLETE")).toEqual([
      I("stages.1.step", "STEP_INCOMPLETE"),
      I("stages.3.step", "STEP_INCOMPLETE"),
    ]);
  });
  it("AC-PB2-04 · RD-06 · step [1,1] (không bắt đầu 0) ⇒ đúng 1 STEP_ORDER ở stages.0.step", () => {
    expect(issues(stepsOnly([1, 1]))).toEqual([I("stages.0.step", "STEP_ORDER")]);
  });
  it("AC-PB2-04 · RD-07 · step [0,2,2] (nhảy) ⇒ STEP_ORDER chỉ stages.1.step", () => {
    expect(issues(stepsOnly([0, 2, 2]))).toEqual([I("stages.1.step", "STEP_ORDER")]);
  });
  it("AC-PB2-04 · RD-08 · step [0,1,0] (giảm) ⇒ STEP_ORDER chỉ stages.2.step", () => {
    expect(issues(stepsOnly([0, 1, 0]))).toEqual([I("stages.2.step", "STEP_ORDER")]);
  });
  it("AC-PB2-04 · RD-09 · STEP_ORDER + real_action + back_to_steps sai ⇒ CHỈ issue STEP_* (bước chưa xác định)", () => {
    const s = [
      st({ key: "a", step: 0 }),
      st({ key: "b", step: 2, review: null, back: [2], real: true }),
    ];
    expect(issues(s)).toEqual([I("stages.1.step", "STEP_ORDER")]);
  });
  it("HUB-FR-104 · RD-10 · nhiều vi phạm cùng stage ⇒ thứ tự key → step → real_action → back", () => {
    const s = [
      st({ key: "a", step: 0 }),
      st({ key: "b", step: 1, review: null }),
      st({ key: "c", step: 1, review: null }),
      st({ key: "d", step: 1, review: null }),
      st({ key: "a", step: 1, review: null, back: [1], real: true }),
    ];
    expect(issues(s)).toEqual([
      I("stages.4.key", "KEY_DUP"),
      I("stages.4.step", "STEP_TOO_WIDE"),
      I("stages.4.real_action", "REAL_ACTION"),
      I("stages.4.after.back_to_steps.0", "BACK_TARGET_INVALID"),
    ]);
  });
  it("HUB-FR-104 · RD-11 · ≥ 25 vi phạm ⇒ cắt còn 20 (i tăng dần)", () => {
    const s = Array.from({ length: 10 }, () => st({ key: "a", step: 0, review: null, real: true }));
    const got = issues(s);
    expect(got).toHaveLength(20);
    expect(got[0]).toEqual(I("stages.0.real_action", "REAL_ACTION"));
  });
  it("HUB-FR-104 · RD-12 · processDefStagePaths(x) = processDefStageIssues(x).map(path) (chữ ký cũ không vỡ)", () => {
    const s = [
      st({ key: "a", step: 0 }),
      st({ key: "a", step: 1, real: true, review: null, back: [3] }),
    ];
    const want = issues(s).map((x) => x.path);
    expect(want.length).toBeGreaterThan(0);
    expect(fn(h, "processDefStagePaths")(s)).toEqual(want);
  });
});

describe("RD · real_action + back_to_steps theo bước [AC-PB2-05][HUB-FR-118]", () => {
  it("AC-PB2-05 · RD-13 · `real_action` ở stage thuộc bước 0 ⇒ REAL_ACTION", () => {
    const s = [st({ key: "a", step: 0, review: null }), st({ key: "b", step: 0, real: true })];
    expect(issues(s)).toEqual([I("stages.1.real_action", "REAL_ACTION")]);
  });
  it("AC-PB2-05 · RD-14 · bước 1 = {review, auto}, stage bước 2 `real_action` ⇒ REAL_ACTION", () => {
    const s = [
      st({ key: "a", step: 0, review: null }),
      st({ key: "b", step: 1, review: null }),
      st({ key: "c", step: 1 }),
      st({ key: "d", step: 2, real: true }),
    ];
    expect(issues(s)).toEqual([I("stages.3.real_action", "REAL_ACTION")]);
  });
  it("AC-PB2-05 · RD-15 · bước 1 = {review, review} ⇒ không issue", () => {
    const s = [
      st({ key: "a", step: 0, review: null }),
      st({ key: "b", step: 1, review: null }),
      st({ key: "c", step: 1, review: null }),
      st({ key: "d", step: 2, real: true }),
    ];
    expect(issues(s)).toEqual([]);
  });
  it("AC-PB2-01 · RD-16 · def cũ không `step`: stage trước review ⇒ ok; auto ⇒ REAL_ACTION (y luật P-a)", () => {
    expect(issues([st({ key: "a", review: null }), st({ key: "b", real: true })])).toEqual([]);
    expect(issues([st({ key: "a" }), st({ key: "b", real: true })])).toEqual([
      I("stages.1.real_action", "REAL_ACTION"),
    ]);
  });
  it("HUB-FR-118 · RD-17 · stage bước 2 `back_to_steps` [2] / [3] / [0,0] ⇒ BACK_TARGET_INVALID ở phần tử sai/trùng", () => {
    const at2 = (back: number[]) => [
      st({ key: "a", step: 0, review: null }),
      st({ key: "b", step: 1, review: null }),
      st({ key: "c", step: 2, review: null, back }),
    ];
    expect(issues(at2([2]))).toEqual([I("stages.2.after.back_to_steps.0", "BACK_TARGET_INVALID")]);
    expect(issues(at2([3]))).toEqual([I("stages.2.after.back_to_steps.0", "BACK_TARGET_INVALID")]);
    expect(issues(at2([0, 0]))).toEqual([
      I("stages.2.after.back_to_steps.1", "BACK_TARGET_INVALID"),
    ]);
  });
  it("HUB-FR-118 · RD-18 · `back_to_steps` [0,1] ở bước 2 ⇒ không issue", () => {
    const s = [
      st({ key: "a", step: 0, review: null }),
      st({ key: "b", step: 1, review: null }),
      st({ key: "c", step: 2, review: null, back: [0, 1] }),
    ];
    expect(issues(s)).toEqual([]);
  });
});

describe("RH · cắt Bàn giao [HUB-FR-136][AC-PB2-09]", () => {
  it("HUB-FR-136 · RH-01 · clipHandoff 800 ký tự ⇒ không cắt, giữ nguyên", () => {
    const t = "H".repeat(800);
    expect(fn(h, "clipHandoff")(t)).toEqual({ text: t, truncated: false });
  });
  it("HUB-FR-136 · RH-02 · clipHandoff 801 ký tự ⇒ cắt 800 + “…”, truncated", () => {
    expect(fn(h, "clipHandoff")("H".repeat(801))).toEqual({
      text: `${"H".repeat(800)}…`,
      truncated: true,
    });
  });
  it("HUB-FR-136 · RH-03 · handoffTokens: '' ⇒ 0, 'abc' ⇒ 1, 801 ký tự ⇒ 201 (ceil /4)", () => {
    const t = fn(h, "handoffTokens");
    expect([t(""), t("abc"), t("H".repeat(801))]).toEqual([0, 1, 201]);
  });
});
