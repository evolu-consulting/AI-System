// HUB-BR-34 · HUB-FR-126 · PC-R02 · P-c1 · plan §4 contracts (`autofixStageIssues` trong `hub-admin/process-steps.ts`, dùng
// chung server + admin-web) · test-plan §3 I01–I06. Hàm vắng ⇒ đỏ ở `fn()`.
import { describe, expect, it } from "bun:test";
import { AUTOFIX, defInput, fn, issuePaths, loadHubAdmin, schema, stage, TEAM } from "./_rules";

const m = await loadHubAdmin();
const af = { source_key: "app-repo" };
const auto = { kind: "auto" };
const review = { kind: "review" };
/** `AutofixStageShape` tối thiểu (plan §4). */
const sh = (o: Record<string, unknown> = {}) => ({
  key: "fix",
  real_action: false,
  after: review,
  executor: { kind: "agent" },
  autofix: af,
  ...o,
});

describe("I01–I06 · autofixStageIssues [PC-R02]", () => {
  it("HUB-BR-34 · I01 · một stage tự-sửa agent + review ⇒ []", () => {
    expect(fn(m, "autofixStageIssues")([sh()])).toEqual([]);
  });
  it("HUB-BR-34 · PC-R02 · I02 · executor team ⇒ {stages.0.executor, AUTOFIX_EXECUTOR}", () => {
    expect(fn(m, "autofixStageIssues")([sh({ executor: { kind: "team" } })])).toEqual([
      { path: "stages.0.executor", rule: "AUTOFIX_EXECUTOR" },
    ]);
  });
  it("HUB-BR-34 · PC-R02 · I03 · after auto ⇒ {stages.0.after, AUTOFIX_REVIEW} (luôn qua người)", () => {
    expect(fn(m, "autofixStageIssues")([sh({ after: auto })])).toEqual([
      { path: "stages.0.after", rule: "AUTOFIX_REVIEW" },
    ]);
  });
  it("HUB-FR-126 · PC-R02 · I04 · > 1 stage tự-sửa ⇒ AUTOFIX_MAX ở stage thứ 2 trở đi (`stages.<i>.autofix`)", () => {
    const f = fn(m, "autofixStageIssues");
    expect(f([sh({ key: "a" }), sh({ key: "b" })])).toEqual([
      { path: "stages.1.autofix", rule: "AUTOFIX_MAX" },
    ]);
    expect(
      f([sh({ key: "a" }), sh({ key: "n", autofix: null }), sh({ key: "b" }), sh({ key: "c" })]),
    ).toEqual([
      { path: "stages.2.autofix", rule: "AUTOFIX_MAX" },
      { path: "stages.3.autofix", rule: "AUTOFIX_MAX" },
    ]);
  });
  it("HUB-BR-34 · I05 · stage không tự-sửa (autofix null/vắng) được team + auto ⇒ []", () => {
    const { autofix: _a, ...noKey } = sh({ executor: { kind: "team" }, after: auto });
    expect(
      fn(
        m,
        "autofixStageIssues",
      )([sh({ executor: { kind: "team" }, after: auto, autofix: null }), noKey]),
    ).toEqual([]);
  });
  it("HUB-BR-34 · PC-R02 · I06 · gộp vào processDefStageIssues / ProcessDefInputSchema (server + FE chung một luật)", () => {
    const issues = fn(
      m,
      "processDefStageIssues",
    )([{ key: "fix", real_action: false, after: auto, executor: { kind: "agent" }, autofix: af }]);
    expect(issues).toContainEqual({ path: "stages.0.after", rule: "AUTOFIX_REVIEW" });
    const s = schema(m, "ProcessDefInputSchema");
    const bad = defInput([
      stage({ key: "a", autofix: AUTOFIX }),
      stage({ key: "b", executor: { kind: "team", team_id: TEAM }, autofix: AUTOFIX }),
    ]);
    const paths = issuePaths(s, bad);
    expect(paths).toContain("stages.1.executor");
    expect(paths).toContain("stages.1.autofix");
  });
});
