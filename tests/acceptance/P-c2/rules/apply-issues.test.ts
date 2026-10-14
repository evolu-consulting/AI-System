// HUB-BR-34 · HUB-BR-38(b) · HUB-FR-129 · PC2-R01 · P-c2 · plan §4 contracts (`applyStageIssues` trong `hub-admin/process-steps.ts`,
// dùng chung server + admin-web) · test-plan P-c2 §4 I01–I09. Hàm vắng ⇒ đỏ ở `fn()`.
import { describe, expect, it } from "bun:test";
import { fn, issuePaths, loadHubAdmin, schema, stage } from "./_rules2";

const m = await loadHubAdmin();
const review = { kind: "review" };
const auto = { kind: "auto" };
/** Stage tự-sửa (bước 0) — `ApplyStageShape` tối thiểu. */
const fix = (o: Record<string, unknown> = {}) => ({
  key: "fix",
  step: 0,
  real_action: false,
  after: review,
  executor: { kind: "agent" },
  autofix: { source_key: "app-repo" },
  sources: [],
  token_budget: null,
  must_know: [],
  ...o,
});
/** Stage Áp hợp lệ (bước 1). */
const ap = (o: Record<string, unknown> = {}) => ({
  key: "apply",
  step: 1,
  real_action: true,
  after: auto,
  executor: { kind: "apply" },
  autofix: null,
  sources: [],
  token_budget: null,
  must_know: [],
  ...o,
});
const issues = (stages: unknown[]) => fn(m, "applyStageIssues")(stages);

describe("I01–I09 · applyStageIssues [PC2-R01]", () => {
  it("HUB-BR-34 · I01 · tự-sửa (bước 0, review) + Áp (bước 1, real_action, auto, trường rỗng) ⇒ []", () => {
    expect(issues([fix(), ap()])).toEqual([]);
  });
  it("HUB-BR-34 · I02 · bước suy từ chỉ số (def không `step`) ⇒ [] khi Áp ngay sau tự-sửa", () => {
    const { step: _a, ...f } = fix();
    const { step: _b, ...a } = ap();
    expect(issues([f, a])).toEqual([]);
  });
  it("HUB-BR-38 · I03 · real_action false ⇒ {stages.1.real_action, APPLY_REAL}", () => {
    expect(issues([fix(), ap({ real_action: false })])).toEqual([
      { path: "stages.1.real_action", rule: "APPLY_REAL" },
    ]);
  });
  it("HUB-BR-34 · I04 · after review ⇒ {stages.1.after, APPLY_AFTER}", () => {
    expect(issues([fix(), ap({ after: review })])).toEqual([
      { path: "stages.1.after", rule: "APPLY_AFTER" },
    ]);
  });
  it("HUB-BR-34 · I05 · không có stage tự-sửa ở bước(Áp)−1 ⇒ {stages.<i>.executor, APPLY_NO_AUTOFIX} (Áp bước 0; Áp cách 2 bước; bước trước chỉ stage thường)", () => {
    expect(issues([ap({ step: 0 })])).toEqual([
      { path: "stages.0.executor", rule: "APPLY_NO_AUTOFIX" },
    ]);
    const plain = fix({ key: "plain", step: 1, autofix: null });
    expect(issues([fix(), plain, ap({ step: 2 })])).toEqual([
      { path: "stages.2.executor", rule: "APPLY_NO_AUTOFIX" },
    ]);
    expect(issues([fix({ autofix: null }), ap()])).toEqual([
      { path: "stages.1.executor", rule: "APPLY_NO_AUTOFIX" },
    ]);
  });
  it("HUB-BR-34 · I06 · > 1 stage Áp ⇒ APPLY_MAX từ stage Áp thứ 2 (`stages.<i>.executor`)", () => {
    expect(issues([fix(), ap(), ap({ key: "apply-2" })])).toEqual([
      { path: "stages.2.executor", rule: "APPLY_MAX" },
    ]);
  });
  it("HUB-BR-34 · I07 · APPLY_FIELDS (`stages.<i>`): sources ≠ [] | autofix ≠ null | token_budget ≠ null | must_know ≠ []", () => {
    const want = [{ path: "stages.1", rule: "APPLY_FIELDS" }];
    expect(
      issues([fix(), ap({ sources: [{ source_key: "app-repo", allowlist: ["**"] }] })]),
    ).toEqual(want);
    expect(issues([fix(), ap({ autofix: { source_key: "app-repo" } })])).toEqual(want);
    expect(issues([fix(), ap({ token_budget: 1000 })])).toEqual(want);
    expect(issues([fix(), ap({ must_know: ["Quy định A"] })])).toEqual(want);
  });
  it("HUB-BR-34 · I08 · stage không phải Áp không bị luật APPLY_* (team/auto/agent)", () => {
    expect(
      issues([fix(), fix({ key: "x", executor: { kind: "team" }, after: auto, autofix: null })]),
    ).toEqual([]);
  });
  it("HUB-BR-34 · I09 · gộp vào processDefStageIssues + ProcessDefInputSchema (server = FE một luật)", () => {
    const all = fn(m, "processDefStageIssues")([fix(), ap({ real_action: false })]);
    expect(all).toContainEqual({ path: "stages.1.real_action", rule: "APPLY_REAL" });
    const s = schema(m, "ProcessDefInputSchema");
    const def = {
      key: "pc2-def",
      name: "Áp thử",
      description: "Quy trình thử P-c2.",
      input_hint: "Mô tả lỗi",
      run_group_ids: [],
      token_budget: null,
      enabled: true,
      sources: ["app-repo"],
      inputs: [],
      stages: [
        stage({
          key: "fix",
          step: 0,
          autofix: {
            source_key: "app-repo",
            install_cmd: null,
            test_cmd: "bun test",
            write_allowlist: [],
          },
        }),
        stage({
          key: "apply",
          step: 1,
          executor: { kind: "apply" },
          after: { kind: "review", group_id: "c2c20000-0000-4000-8000-000000000013" },
          real_action: true,
        }),
      ],
    };
    expect(issuePaths(s, def)).toContain("stages.1.after");
    const good = { ...def, stages: [def.stages[0], { ...def.stages[1], after: { kind: "auto" } }] };
    expect(issuePaths(s, good)).toEqual([]);
  });
});
