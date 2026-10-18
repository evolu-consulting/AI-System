// AC-H44 · AC-H45 · HUB-FR-146/147 · test-plan-d2 §1 PD2-U01…U03, PD2-U10…U11: luật lưu def stage `tool` + rẽ nhánh — hàm thuần
// contract `toolStageIssues`/`branchStageIssues` (`@ai/contracts/hub-admin`, plan-addendum A2: hình bản nháp snake_case + bảng
// path). Domain cùng điều kiện, parity ở `def-rules-parity.test.ts` (backend, A2). Export vắng ⇒ đỏ ở expect của `fn`.
import { describe, expect, it } from "bun:test";
import { fn, loadHubAdmin } from "../../_support/modules";
import { AG, G_DUYET } from "../_contracts";

const ha = await loadHubAdmin();
type Issue = { path: string; rule: string };
type Rec = Record<string, unknown>;

const PARAMS = [
  { name: "tong_tien", type: "number", required: true },
  { name: "ma_kh", type: "text", required: false },
];
const TOOLS = new Map<string, Rec>([
  ["xuat-hoa-don", { key: "xuat-hoa-don", side_effect: false, params: PARAMS }],
  ["ghi-so", { key: "ghi-so", side_effect: true, params: PARAMS }],
  [
    "tai-file",
    {
      key: "tai-file",
      side_effect: false,
      params: [{ name: "tep", type: "file", required: true }],
    },
  ],
]);
const INPUTS = [{ key: "ma-kh", type: "text" }];
const s0 = (o: Rec = {}): Rec => ({
  key: "s0",
  step: 0,
  real_action: false,
  executor: { kind: "agent", agent_id: AG },
  after: { kind: "review", group_id: G_DUYET, back_to_steps: [] },
  output: { fields: [{ key: "tong_tien", type: "number", required: true }] },
  ...o,
});
const ARGS_OK: Rec = {
  tong_tien: { from: "field", stage_key: "s0", field: "tong_tien" },
  ma_kh: { from: "const", value: "KH1" },
};
const toolDraft = (o: Rec = {}, args: Rec = ARGS_OK, key = "xuat-hoa-don"): Rec => ({
  key: "s1",
  step: 1,
  real_action: false,
  executor: { kind: "tool", tool_key: key, args },
  after: { kind: "auto" },
  answerer: { kind: "starter" },
  sources: [],
  must_know: [],
  autofix: null,
  output: { fields: [] },
  ...o,
});
const toolIssues = (stages: Rec[]): Issue[] =>
  fn(ha, "toolStageIssues")(stages, INPUTS, TOOLS) as Issue[];
const T = (path: string) => ({ path, rule: "TOOL_INVALID" });

describe("PD2-U01…U03 · toolStageIssues [plan-addendum A2]", () => {
  it("AC-H44 · PD2-U01 · field ở bước trước + const ⇒ []; tool_key không có trong catalog ⇒ [] (server trả PROCESS_REF_INVALID)", () => {
    expect(toolIssues([s0(), toolDraft()])).toEqual([]);
    expect(toolIssues([s0(), toolDraft({}, ARGS_OK, "khong-co")])).toEqual([]);
  });
  it("AC-H44 · PD2-U02 · 21 args / tool có param file / sources / must_know / autofix / answerer≠starter ⇒ stages.1.executor", () => {
    const many: Rec = { ...ARGS_OK };
    for (let i = 0; i < 19; i++) many[`x${i}`] = { from: "const", value: i };
    const cases: Rec[] = [
      toolDraft({}, many),
      toolDraft({}, { tep: { from: "const", value: "a" } }, "tai-file"),
      toolDraft({ sources: [{ kind: "x" }] }),
      toolDraft({ must_know: ["a"] }),
      toolDraft({ autofix: { kind: "x" } }),
      toolDraft({ answerer: { kind: "group", group_id: G_DUYET } }),
    ];
    for (const c of cases) expect(toolIssues([s0(), c])).toContainEqual(T("stages.1.executor"));
  });
  it("AC-H44 · PD2-U02 · thiếu required ⇒ path args.<tên param thiếu>; tên ∉ params / input không có / field cùng bước, bước sau, không khai ⇒ args.<tên>", () => {
    expect(toolIssues([s0(), toolDraft({}, { ma_kh: { from: "const", value: "a" } })])).toEqual([
      T("stages.1.executor.args.tong_tien"),
    ]);
    const bad = (arg: Rec) => toolIssues([s0(), toolDraft({}, { ...ARGS_OK, ...arg })]);
    expect(bad({ xyz: { from: "const", value: 1 } })).toEqual([T("stages.1.executor.args.xyz")]);
    expect(bad({ ma_kh: { from: "input", key: "khong-co" } })).toEqual([
      T("stages.1.executor.args.ma_kh"),
    ]);
    expect(bad({ tong_tien: { from: "field", stage_key: "s0", field: "khong_khai" } })).toEqual([
      T("stages.1.executor.args.tong_tien"),
    ]);
    const sameStep = toolIssues([s0(), toolDraft({ step: 0 })]);
    expect(sameStep).toContainEqual(T("stages.1.executor.args.tong_tien"));
    const later = toolIssues([toolDraft({ step: 0 }), s0({ step: 1 })]);
    expect(later).toContainEqual(T("stages.0.executor.args.tong_tien"));
  });
  it("AC-H44 · PD2-U03 · tool side_effect ở stage real_action:false ⇒ TOOL_SIDE_EFFECT path stages.<i>.real_action; real_action:true ⇒ không", () => {
    expect(toolIssues([s0(), toolDraft({}, ARGS_OK, "ghi-so")])).toEqual([
      { path: "stages.1.real_action", rule: "TOOL_SIDE_EFFECT" },
    ]);
    expect(toolIssues([s0(), toolDraft({ real_action: true }, ARGS_OK, "ghi-so")])).toEqual([]);
  });
});

// ---------- rẽ nhánh ----------
const RULE = { field: "tong_tien", op: "gt", value: 20_000_000, goto_step: 3 };
const stg = (key: string, step: number, o: Rec = {}): Rec => ({
  key,
  step,
  real_action: false,
  executor: { kind: "agent", agent_id: AG },
  after: { kind: "auto" },
  output: { fields: [] },
  ...o,
});
/** Def 5 bước (0…4); s1 ở bước 1 có `branch`. */
function branchDef(branch: Rec[], o: Rec = {}, extra: Rec[] = []): Rec[] {
  return [
    stg("s0", 0),
    stg("s1", 1, {
      output: {
        fields: [
          { key: "tong_tien", type: "number", required: true },
          { key: "loai", type: "string", required: false },
          { key: "han", type: "date", required: false },
        ],
      },
      after: { kind: "review", group_id: G_DUYET, back_to_steps: [], branch },
      ...o,
    }),
    stg("s2", 2),
    stg("s3", 3),
    stg("s4", 4),
    ...extra,
  ];
}
const branchIssues = (stages: Rec[]): Issue[] => fn(ha, "branchStageIssues")(stages) as Issue[];
const B = (path: string) => ({ path, rule: "BRANCH_INVALID" });

describe("PD2-U10…U11 · branchStageIssues [plan-addendum A2]", () => {
  it("AC-H45 · PD2-U10 · tong_tien gt 20000000 ⇒ goto 3 ở stage bước 1 đứng một mình ⇒ []", () => {
    expect(branchIssues(branchDef([RULE]))).toEqual([]);
  });
  it("AC-H45 · PD2-U11 · 11 luật / stage cùng bước với stage khác ⇒ stages.1.after.branch", () => {
    expect(branchIssues(branchDef(Array.from({ length: 11 }, () => RULE)))).toContainEqual(
      B("stages.1.after.branch"),
    );
    expect(branchIssues(branchDef([RULE], {}, [stg("s1b", 1)]))).toContainEqual(
      B("stages.1.after.branch"),
    );
  });
  it("AC-H45 · PD2-U11 · field ∉ fields ⇒ .field; lt với string ⇒ .op; value khác kiểu / date sai lịch ⇒ .value", () => {
    const one = (r: Rec) => branchIssues(branchDef([{ ...RULE, ...r }]));
    expect(one({ field: "khong_co" })).toEqual([B("stages.1.after.branch.0.field")]);
    expect(one({ field: "loai", op: "lt", value: "a" })).toEqual([B("stages.1.after.branch.0.op")]);
    expect(one({ value: "abc" })).toEqual([B("stages.1.after.branch.0.value")]);
    expect(one({ field: "han", op: "lt", value: "2026-02-30" })).toEqual([
      B("stages.1.after.branch.0.value"),
    ]);
  });
  it("AC-H45 · PD2-U11 · goto_step = step / < step / ≥ số bước / đích real_action khi after≠review ⇒ .goto_step", () => {
    const one = (g: number, o: Rec = {}) => branchIssues(branchDef([{ ...RULE, goto_step: g }], o));
    const P = B("stages.1.after.branch.0.goto_step");
    expect(one(1)).toEqual([P]);
    expect(one(0)).toEqual([P]);
    expect(one(5)).toEqual([P]);
    const realTarget = branchDef([RULE], { after: { kind: "auto", branch: [RULE] } });
    (realTarget[3] as Rec).real_action = true;
    expect(branchIssues(realTarget)).toEqual([P]);
  });
});
