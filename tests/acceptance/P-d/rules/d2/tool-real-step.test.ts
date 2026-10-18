// AC-H44 · HUB-FR-146 · HUB-BR-12 · D2-49 · TECH-DEBT #204 (hướng A) · test-plan-d2 §1 PD2-U21…U24: stage `tool` bật
// `real_action` ở bước 0 / sau bước có stage `after≠review` bị chặn NGAY khi lưu def (luật chung `REAL_ACTION`), không đợi
// tới lúc chạy mới `tool_failed`. Hai tầng: contract `processDefStageIssues`/`toolStageIssues` (`@ai/contracts/hub-admin`,
// FE dùng) + BE `validateProcessDef` (`defs/def.rules.ts`, route trả 422). Không thêm luật mới.
import { describe, expect, it } from "bun:test";
import { loadDefRules } from "../../../P-a/_support/modules";
import { fn, loadHubAdmin } from "../../_support/modules";
import { AG, G_DUYET } from "../_contracts";

const ha = await loadHubAdmin();
const defRules = await loadDefRules();
type Issue = { path: string; rule: string };
// biome-ignore lint/suspicious/noExplicitAny: object thử theo contract ProcessStageDef
type J = any;

const PARAMS = [
  { name: "tong_tien", type: "number", required: true },
  { name: "ma_kh", type: "text", required: false },
];
/** Contract (snake_case) và domain BE (`sideEffect`) — cùng hai tool: thường + có tác dụng phụ. */
const C_TOOLS = new Map<string, J>([
  ["xuat-hoa-don", { key: "xuat-hoa-don", side_effect: false, params: PARAMS }],
  ["ghi-so", { key: "ghi-so", side_effect: true, params: PARAMS }],
]);
const refs = {
  agentIds: new Set([AG]),
  teamIds: new Set<string>(),
  groupIds: new Set([G_DUYET]),
  userIds: new Set<string>(),
  tools: new Map<string, J>([
    ["xuat-hoa-don", { key: "xuat-hoa-don", sideEffect: false, params: PARAMS }],
    ["ghi-so", { key: "ghi-so", sideEffect: true, params: PARAMS }],
  ]),
};
const ARGS = {
  tong_tien: { from: "const", value: 25_000_000 },
  ma_kh: { from: "const", value: "KH1" },
};
const REVIEW = { kind: "review", group_id: G_DUYET, back_to_steps: [] };

const base = (key: string, step: number, o: J = {}): J => ({
  key,
  name: `Giai đoạn ${key}`,
  step,
  executor: { kind: "agent", agent_id: AG },
  instruction: "",
  output: { filename: `${key}.md`, template: "## A\n", required_sections: ["A"], fields: [] },
  after: REVIEW,
  real_action: false,
  answerer: { kind: "starter" },
  sources: [],
  must_know: [],
  autofix: null,
  timeout_s: 600,
  token_budget: null,
  ...o,
});
const tool = (key: string, step: number, toolKey: string, o: J = {}): J =>
  base(key, step, {
    executor: { kind: "tool", tool_key: toolKey, args: ARGS },
    after: { kind: "auto" },
    ...o,
  });
const def = (stages: J[]): J => ({
  key: "p-tool-real",
  name: "Quy trình tool thật",
  description: "",
  input_hint: "",
  run_group_ids: [],
  inputs: [],
  stages,
  token_budget: null,
  enabled: true,
});

const stageIssues = (stages: J[]): Issue[] =>
  fn(ha, "processDefStageIssues")(stages, { inputs: [] }) as Issue[];
const toolIssues = (stages: J[]): Issue[] =>
  fn(ha, "toolStageIssues")(stages, [], C_TOOLS) as Issue[];
const validate = (stages: J[]) => fn(defRules, "validateProcessDef")(def(stages), refs);
const RA = (i: number) => ({ path: `stages.${i}.real_action`, rule: "REAL_ACTION" });

describe("PD2-U21…U24 · stage tool + real_action theo bước trước [D2-49, #204]", () => {
  it("HUB-BR-12 · PD2-U21 · stage tool real_action ở bước 0 ⇒ REAL_ACTION stages.0.real_action (contract + BE 422)", () => {
    const stages = [tool("s0", 0, "xuat-hoa-don", { real_action: true })];
    expect(stageIssues(stages)).toContainEqual(RA(0));
    const r = validate(stages);
    expect(r).toMatchObject({ ok: false, code: "PROCESS_DEF_INVALID" });
    expect(r.rules).toContain("REAL_ACTION");
    expect(r.paths).toContain("stages.0.real_action");
  });

  it("HUB-BR-12 · PD2-U22 · stage tool real_action ở bước 1 sau s0 `auto` ⇒ REAL_ACTION stages.1.real_action", () => {
    const stages = [
      base("s0", 0, { after: { kind: "auto" } }),
      tool("s1", 1, "ghi-so", { real_action: true }),
    ];
    expect(stageIssues(stages)).toContainEqual(RA(1));
    const r = validate(stages);
    expect(r).toMatchObject({ ok: false, code: "PROCESS_DEF_INVALID" });
    expect(r.rules).toContain("REAL_ACTION");
    expect(r.paths).toContain("stages.1.real_action");
  });

  it("HUB-BR-12 · PD2-U23 · sau s0 `review` ⇒ không REAL_ACTION; BE ok (cả tool thường lẫn side_effect)", () => {
    for (const k of ["xuat-hoa-don", "ghi-so"]) {
      const stages = [base("s0", 0), tool("s1", 1, k, { real_action: true })];
      expect(stageIssues(stages).filter((i) => i.rule === "REAL_ACTION")).toEqual([]);
      expect(toolIssues(stages)).toEqual([]);
      expect(validate(stages)).toEqual({ ok: true });
    }
  });

  it("AC-H44 · PD2-U24 · tool side_effect ở bước 0 real:false ⇒ đúng một TOOL_SIDE_EFFECT stages.0.real_action, không TOOL_INVALID; bật real ⇒ REAL_ACTION (không bật được)", () => {
    const off = [tool("s0", 0, "ghi-so")];
    expect(toolIssues(off)).toEqual([{ path: "stages.0.real_action", rule: "TOOL_SIDE_EFFECT" }]);
    const r = validate(off);
    expect(r).toMatchObject({ ok: false, code: "PROCESS_DEF_INVALID" });
    expect(r.rules).toEqual(["TOOL_SIDE_EFFECT"]);
    expect(r.paths).toEqual(["stages.0.real_action"]);
    const on = [tool("s0", 0, "ghi-so", { real_action: true })];
    expect(toolIssues(on)).toEqual([]);
    const r2 = validate(on);
    expect(r2.rules).toEqual(["REAL_ACTION"]);
    expect(r2.paths).toEqual(["stages.0.real_action"]);
  });
});
