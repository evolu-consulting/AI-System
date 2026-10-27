// contract-flow S2 · luật thuần mẫu luồng duyệt: điều kiện AND/OR (trống ⇒ cần bước), mẫu mặc định = 2 bước cũ, kiểm mẫu,
// bước kế áp dụng, và def dịch ra qua được bộ kiểm của engine (`ProcessDefInputSchema` + `branchStageIssues`).
import { describe, expect, it } from "bun:test";
import * as C from "@ai/contracts";
import {
  branchStageIssues,
  ESCALATE_AFTER_H,
  ProcessDefInputSchema,
  REMIND_EVERY_H,
} from "@ai/contracts/hub-admin";
import { needsLevel2 } from "./approval-def.rules";
import {
  compileDef,
  type DifyWorkflow,
  defaultFlowFromSettings,
  difyArgs,
  difyRunInputs,
  difySelectBindings,
  engineStepOf,
  nextApplicable,
  requiredSteps,
  routeNext,
  validateDifyCatalog,
  validateFlow,
  whenHolds,
} from "./approval-flow.rules";
import type * as T from "./approval-flow.types";
import {
  APPROVAL_FLOW_DUE_DEFAULT_H,
  APPROVAL_FLOW_DUE_H,
  APPROVAL_FLOW_REMIND_H,
  APPROVAL_FLOW_STEPS_MAX,
} from "./approval-flow.types";
import { dealOptionMap } from "./approval-flow-dify.rules";

const G = {
  l1: "00000000-0000-4000-8000-000000000001",
  l2: "00000000-0000-4000-8000-000000000002",
  law: "00000000-0000-4000-8000-000000000003",
  acc: "00000000-0000-4000-8000-000000000004",
  dir: "00000000-0000-4000-8000-000000000005",
};
const ALL = new Set(Object.values(G));
const SETTINGS = { threshold: 500_000_000, level1GroupKey: "ed", level2GroupKey: "own" };
const KEYS = new Map([
  ["ed", G.l1],
  ["own", G.l2],
]);

const review = (key: string, group: string, o: Partial<FlowStep> = {}): FlowStep =>
  ({
    kind: "review",
    key,
    name: key,
    department_group_id: group,
    head_only: false,
    due_h: 48,
    remind_every_h: 24,
    escalate_group_id: null,
    exclude_starter: false,
    when: null,
    ...o,
  }) as FlowStep;
const dify = (key: string): FlowStep => ({
  kind: "dify",
  key,
  name: key,
  workflow_key: "risk-scan",
  after: "auto",
});

const p = (name: string, type: string, required: boolean) => ({ name, type, required });
const wf = (params: ReturnType<typeof p>[], key = "risk-scan"): DifyWorkflow => ({
  key,
  name: key,
  params,
});
const WFS = new Map([
  [
    "risk-scan",
    wf([
      p("contract_id", "text", true),
      p("total_value", "number", false),
      p("khac", "text", false),
    ]),
  ],
]);

/** 4 phòng: Kinh doanh → Pháp chế → Kế toán (không cho giới thiệu) → Giám đốc (≥ 1 tỷ hoặc mua). */
const FOUR: FlowStep[] = [
  review("sales", G.l1),
  review("legal", G.law, { escalate_group_id: G.dir }),
  review("acc", G.acc, {
    when: { op: "and", conds: [{ field: "deal", in: ["buy", "sell"] }] },
  }),
  review("dir", G.dir, {
    exclude_starter: true,
    when: {
      op: "or",
      conds: [
        { field: "total_value", op: "ge", value: 1_000_000_000 },
        { field: "deal", in: ["buy"] },
      ],
    },
  }),
];

/** Bộ kiểm def của engine (hình dạng + luật chéo stage + luật rẽ). */
function engineIssues(def: ReturnType<typeof compileDef>) {
  const p = ProcessDefInputSchema.safeParse(def);
  const shape = p.success ? [] : p.error.issues.map((i) => `${i.path.join(".")}:${i.message}`);
  return [...shape, ...branchStageIssues(def.stages as never).map((i) => `${i.path}:${i.rule}`)];
}

type FlowStep = C.FlowStep;
// ADR-0023 · bản sao domain khớp DTO: kiểu gán được hai chiều (tsc), hằng bằng nhau (chạy).
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const parity: [
  Same<T.FlowStep, C.FlowStep>,
  Same<T.ApprovalFlowResponse, C.ApprovalFlowResponse>,
  Same<T.ApprovalFlowIssue, C.ApprovalFlowIssue>,
] = [true, true, true];
describe("bản sao DTO", () => {
  it("hằng domain = contracts = engine", () => {
    expect(parity).toEqual([true, true, true]);
    expect([
      APPROVAL_FLOW_STEPS_MAX,
      APPROVAL_FLOW_DUE_H,
      APPROVAL_FLOW_REMIND_H,
      APPROVAL_FLOW_DUE_DEFAULT_H,
    ]).toEqual([
      C.APPROVAL_FLOW_STEPS_MAX,
      ESCALATE_AFTER_H,
      REMIND_EVERY_H,
      C.APPROVAL_FLOW_DUE_DEFAULT_H,
    ]);
    expect([C.APPROVAL_FLOW_DUE_H, C.APPROVAL_FLOW_REMIND_H]).toEqual([
      APPROVAL_FLOW_DUE_H,
      APPROVAL_FLOW_REMIND_H,
    ]);
  });
});

describe("điều kiện AND/OR", () => {
  const and = FOUR[3]?.kind === "review" ? FOUR[3].when : null;
  it("OR: đủ một vế; giá trị trống/âm/không số ⇒ vế giá trị đúng (cần bước)", () => {
    expect([
      whenHolds(and, { deal: "sell", total_value: 2_000_000_000 }),
      whenHolds(and, { deal: "buy", total_value: 1 }),
      whenHolds(and, { deal: "sell", total_value: 1 }),
      whenHolds(and, { deal: "sell", total_value: null }),
      whenHolds(and, { deal: "sell", total_value: -5 }),
      whenHolds(and, { deal: "sell", total_value: "x" }),
    ]).toEqual([true, true, false, true, true, true]);
  });
  it("AND: mọi vế; loại HĐ trống ⇒ vế loại đúng", () => {
    const w = {
      op: "and" as const,
      conds: [
        { field: "deal" as const, in: ["sell" as const] },
        { field: "total_value" as const, op: "lt" as const, value: 100 },
      ],
    };
    expect([
      whenHolds(w, { deal: "sell", total_value: 50 }),
      whenHolds(w, { deal: "buy", total_value: 50 }),
      whenHolds(w, { deal: "sell", total_value: 100 }),
      whenHolds(w, { deal: null, total_value: 50 }),
      whenHolds(null, { deal: null, total_value: null }),
    ]).toEqual([true, false, false, true, true]);
  });
});

describe("mẫu mặc định = 2 bước cũ", () => {
  const steps = defaultFlowFromSettings(SETTINGS, KEYS);
  it("bước 1 nhóm cấp 1 (người gửi được), bước 2 nhóm cấp 2 exclude_starter; hợp lệ theo DTO + luật", () => {
    expect(
      steps.map((s) => s.kind === "review" && [s.department_group_id, s.exclude_starter]),
    ).toEqual([
      [G.l1, false],
      [G.l2, true],
    ]);
    expect(validateFlow(steps)).toEqual([]);
    const r = { version: 1, is_default: true, steps, updated_at: null };
    expect(C.ApprovalFlowResponseSchema.safeParse(r).success).toBe(true);
  });
  it("cấp 2 cần đúng khi needsLevel2 (≥ ngưỡng, trống, âm, không số)", () => {
    for (const v of [0, 499_999_999, 500_000_000, 9e12, null, -1, Number.NaN, "abc"]) {
      const need = requiredSteps(steps, { deal: "sell", total_value: v }).includes(1);
      expect({ v, need }).toEqual({ v, need: needsLevel2(v, SETTINGS.threshold) });
    }
  });
  it("Group thiếu ở tenant ⇒ department_group_id null ⇒ GROUP_REQUIRED", () => {
    const s = defaultFlowFromSettings(SETTINGS, new Map([["ed", G.l1]]));
    expect(validateFlow(s)).toEqual([
      { path: "steps.1.department_group_id", rule: "GROUP_REQUIRED" },
    ]);
  });
});

describe("validateFlow", () => {
  it("bước 0 có điều kiện / là Dify, khoá trùng, sau Dify có điều kiện, chuyển cấp = nhóm duyệt, hạn/nhắc ngoài khoảng, > 8 bước", () => {
    const cond = { op: "and" as const, conds: [{ field: "deal" as const, in: ["buy" as const] }] };
    expect(
      validateFlow([
        review("a", G.l1, { when: cond }),
        dify("d"),
        review("a", G.law, { when: cond, escalate_group_id: G.law, due_h: 3, remind_every_h: 200 }),
      ]),
    ).toEqual([
      { path: "steps.0.when", rule: "FIRST_CONDITIONAL" },
      { path: "steps.2.key", rule: "KEY_DUP" },
      { path: "steps.2.when", rule: "AFTER_DIFY_CONDITIONAL" },
      { path: "steps.2.escalate_group_id", rule: "ESCALATE_SAME_GROUP" },
      { path: "steps.2.due_h", rule: "DUE_RANGE" },
      { path: "steps.2.remind_every_h", rule: "REMIND_RANGE" },
    ]);
    expect(validateFlow([dify("d")]).map((i) => i.rule)).toEqual(["FIRST_NOT_REVIEW"]);
    const nine = Array.from({ length: 9 }, (_, i) => review(`k${i}`, G.l1));
    expect(validateFlow(nine).map((i) => i.rule)).toEqual(["STEPS_MAX"]);
  });
});

describe("cf-dify · catalog bước Dify", () => {
  const steps = [review("a", G.l1), dify("d")];
  it("khoá không có trong catalog ⇒ DIFY_WORKFLOW_UNKNOWN; tham số bắt buộc lạ / sai kiểu ⇒ DIFY_PARAM_UNSUPPORTED; hợp lệ ⇒ rỗng", () => {
    expect(validateDifyCatalog(steps, [])).toEqual([
      { path: "steps.1.workflow_key", rule: "DIFY_WORKFLOW_UNKNOWN" },
    ]);
    const bad = (params: ReturnType<typeof p>[]) =>
      validateDifyCatalog(steps, [wf(params)]).map((i) => i.rule);
    expect(bad([p("tong_tien", "number", true)])).toEqual(["DIFY_PARAM_UNSUPPORTED"]);
    expect(bad([p("title", "select", true)])).toEqual(["DIFY_PARAM_UNSUPPORTED"]);
    expect(bad([p("title", "number", true)])).toEqual(["DIFY_PARAM_UNSUPPORTED"]);
    expect(bad([p("tong_tien", "number", false), p("title", "text", true)])).toEqual([]);
    expect(validateDifyCatalog([review("a", G.l1)], [])).toEqual([]);
  });
  it("dify-input-map · ánh xạ tham số ⇒ trường HĐ: hợp lệ, khoá lạ, sai kiểu, args runtime", () => {
    const han = wf([p("contract_value", "number", true), p("contract_type", "text", true)]);
    const withMap = (inputs?: Record<string, string>) =>
      [review("a", G.l1), { ...dify("d"), inputs }] as FlowStep[];
    const rules = (inputs?: Record<string, string>) =>
      validateDifyCatalog(withMap(inputs), [han]).map((i) => `${i.path}:${i.rule}`);
    const full = { contract_value: "total_value", contract_type: "deal" };
    expect(rules()).toEqual(["steps.1.workflow_key:DIFY_PARAM_UNSUPPORTED"]);
    expect(rules(full)).toEqual([]);
    expect(rules({ ...full, nope: "title" })).toEqual(["steps.1.inputs.nope:DIFY_INPUT_UNKNOWN"]);
    expect(rules({ ...full, contract_value: "title" })).toEqual([
      "steps.1.inputs.contract_value:DIFY_PARAM_UNSUPPORTED",
    ]);
    // runtime: mỗi tham số lấy input run của trường được ánh xạ; tham số cùng tên vẫn gửi như cũ.
    expect(difyArgs(han, full)).toEqual({
      contract_value: { from: "input", key: "contract-value" },
      contract_type: { from: "input", key: "contract-deal" },
    });
    const same = wf([p("partner", "text", true), p("note", "text", false)]);
    expect(difyArgs(same)).toEqual({ partner: { from: "input", key: "contract-partner" } });
    const def = compileDef(
      { steps: withMap(full) },
      new Set([G.l1]),
      new Map([["risk-scan", han]]),
    );
    const st = def.stages.find((s) => s.executor.tool_key === "risk-scan");
    expect(st?.executor.args).toEqual(difyArgs(han, full));
  });
  it("dify-input-map · schema prod dify-han-muc-duyet: select ← deal, run input = nhãn lựa chọn", () => {
    const prod: DifyWorkflow = {
      key: "dify-han-muc-duyet",
      name: "Hạn mức",
      params: [
        p("contract_value", "number", true),
        {
          ...p("contract_type", "select", true),
          options: ["Mua", "Bán", "Giới thiệu"],
        },
        p("partner_name", "text", false),
      ],
    };
    const inputs = {
      contract_value: "total_value",
      contract_type: "deal",
      partner_name: "partner",
    };
    const steps = [
      review("a", G.l1),
      { ...dify("d"), workflow_key: prod.key, inputs },
    ] as FlowStep[];
    expect(validateDifyCatalog(steps, [prod])).toEqual([]);
    const def = compileDef({ steps }, new Set([G.l1]), new Map([[prod.key, prod]]));
    const st = def.stages.find((s) => s.executor.tool_key === prod.key);
    expect(st?.executor.args).toEqual({
      contract_value: { from: "input", key: "contract-value" },
      contract_type: { from: "input", key: "dify-sel-1-1" },
      partner_name: { from: "input", key: "contract-partner" },
    });
    expect(def.inputs.map((i) => i.key)).toContain("dify-sel-1-1");
    const sel = difySelectBindings(steps, [prod]);
    const run = (deal: string | null) =>
      difyRunInputs({ title: "t", deal, totalValue: 5, partner: "ACME" }, sel);
    expect(run("sell")).toContainEqual({ type: "text", key: "dify-sel-1-1", text: "Bán" });
    expect(run("buy")).toContainEqual({ type: "text", key: "dify-sel-1-1", text: "Mua" });
    expect(run("sell")).toContainEqual({ type: "text", key: "contract-partner", text: "ACME" });
    // select không có đủ nhãn khớp / ánh xạ từ trường khác ⇒ không hỗ trợ; nhãn thô buy/sell/referral gửi thô.
    const sw = (options: string[]) => ({
      ...prod,
      params: [{ ...p("contract_type", "select", true), options }],
    });
    const rule = (w: DifyWorkflow, m: Record<string, string>) =>
      validateDifyCatalog(
        [review("a", G.l1), { ...dify("d"), workflow_key: w.key, inputs: m }] as FlowStep[],
        [w],
      ).map((i) => i.rule);
    expect(rule(sw(["Mua", "Bán"]), { contract_type: "deal" })).toEqual(["DIFY_PARAM_UNSUPPORTED"]);
    expect(rule(prod, { ...inputs, contract_type: "title" })).toEqual(["DIFY_PARAM_UNSUPPORTED"]);
    expect(dealOptionMap(["buy", "sell", "referral"])).toEqual({
      buy: "buy",
      sell: "sell",
      referral: "referral",
    });
    expect(dealOptionMap(["MUA HÀNG", "Bán hàng", "Giới Thiệu"])).toEqual({
      buy: "MUA HÀNG",
      sell: "Bán hàng",
      referral: "Giới Thiệu",
    });
    expect(C.flowDealOptionMap(["MUA HÀNG", "Bán hàng", "Giới Thiệu"])).toEqual(
      dealOptionMap(["MUA HÀNG", "Bán hàng", "Giới Thiệu"]),
    );
  });
  it("input run: văn bản cắt trần, giá trị không hợp lệ ⇒ 0", () => {
    const base = { title: "HĐ", deal: null, partner: "B" };
    const val = (v: unknown) => difyRunInputs({ ...base, totalValue: v }).at(-1);
    expect(val(1500)).toEqual({ type: "number", key: "contract-value", value: "1500" });
    expect(val(null)).toMatchObject({ value: "0" });
    expect(val(-5)).toMatchObject({ value: "0" });
    const big = difyRunInputs({ ...base, title: "x".repeat(5000), totalValue: 1 })[0];
    expect(big).toMatchObject({ type: "text", key: "contract-title" });
    expect((big as { text: string }).text.length).toBe(2000);
  });
});

describe("bước kế áp dụng", () => {
  it("giới thiệu nhỏ: bỏ Kế toán + Giám đốc ⇒ sau Pháp chế ghi Đã duyệt; mua: đủ 4", () => {
    const ref = { deal: "referral" as const, total_value: 10 };
    expect([nextApplicable(FOUR, ref, 0), nextApplicable(FOUR, ref, 1)]).toEqual([1, 4]);
    expect(requiredSteps(FOUR, ref)).toEqual([0, 1]);
    expect(requiredSteps(FOUR, { deal: "buy", total_value: 10 })).toEqual([0, 1, 2, 3]);
    expect(requiredSteps(FOUR, { deal: "sell", total_value: 10 })).toEqual([0, 1, 2]);
    // `next` = bước engine: user 1 ⇒ 2; ghi Đã duyệt (user 4) ⇒ 5.
    expect([routeNext(FOUR, ref, 0), routeNext(FOUR, ref, 1)]).toEqual([2, 5]);
    expect([0, 1, 2, 4].map(engineStepOf)).toEqual([0, 2, 3, 5]);
  });
});

describe("compileDef ⇒ def engine", () => {
  it("mẫu mặc định: s0 → route → s1 → finalize; qua bộ kiểm engine", () => {
    const def = compileDef({ steps: defaultFlowFromSettings(SETTINGS, KEYS) }, ALL);
    expect(def.stages.map((s) => [s.key, s.step, s.executor.tool_key, s.after.kind])).toEqual([
      ["s0", 0, "contracts-route", "review"],
      ["route", 1, "contracts-route", "auto"],
      ["s1", 2, "contracts-route", "review"],
      ["finalize", 3, "contracts-finalize", "auto"],
    ]);
    expect(def.stages[1]?.after).toEqual({
      kind: "auto",
      branch: [{ field: "next", op: "eq", value: 3, goto_step: 3 }],
    });
    expect({ key: def.key, ttl: def.ttl_days }).toEqual({ key: "contracts-approval", ttl: null });
    expect(engineIssues(def)).toEqual([]);
  });
  it("prod-fix2 · Group Toàn quyền ⇒ `also_group_ids` ở mọi bước duyệt (trừ chính Group bước, Group không còn); qua bộ kiểm", () => {
    const steps = defaultFlowFromSettings(SETTINGS, KEYS);
    const gone = "00000000-0000-4000-8000-0000000000ff";
    const def = compileDef({ steps }, ALL, new Map(), [G.l2, G.l2, gone]);
    const also = def.stages.map((s) => (s.after as { also_group_ids?: string[] }).also_group_ids);
    expect(also).toEqual([[G.l2], undefined, undefined, undefined]);
    expect(engineIssues(def)).toEqual([]);
    const plain = compileDef({ steps }, ALL);
    expect(plain.stages.some((s) => "also_group_ids" in s.after)).toBe(false);
  });
  it("luồng 4 phòng + Dify + chuyển cấp: rẽ next eq j → goto j, Trả lại về bước 0; qua bộ kiểm engine", () => {
    const steps = [...FOUR.slice(0, 2), dify("scan"), ...FOUR.slice(2)];
    const def = compileDef({ steps }, ALL, WFS);
    expect(def.stages.length).toBe(7);
    const legal = def.stages[2]?.after as Record<string, unknown>;
    expect(legal).toMatchObject({
      group_id: G.law,
      back_to_steps: [0],
      escalate: { after_h: 48, group_id: G.dir },
      remind_every_h: 24,
    });
    expect((legal.branch as { goto_step: number }[]).map((b) => b.goto_step)).toEqual([4, 5, 6]);
    // cf-dify · args = tham số workflow thoả được từ dữ liệu HĐ (input run), tham số tuỳ chọn lạ bị bỏ.
    expect(def.stages[3]?.executor).toEqual({
      kind: "tool",
      tool_key: "risk-scan",
      args: {
        contract_id: { from: "input", key: "contract-id" },
        total_value: { from: "input", key: "contract-value" },
      },
    });
    expect(def.inputs.map((i) => i.key)).toEqual([
      "contract-id",
      "contract-title",
      "contract-deal",
      "contract-value",
      "contract-partner",
    ]);
    expect(engineIssues(def)).toEqual([]);
  });
  it("cf-dify · workflow thiếu / tham số bắt buộc không thoả ⇒ compile ném; không bước Dify ⇒ chỉ input contract-id", () => {
    const steps = [review("a", G.l1), dify("scan")];
    expect(() => compileDef({ steps }, ALL)).toThrow("approval-flow-dify-missing");
    expect(() =>
      compileDef({ steps }, ALL, new Map([["risk-scan", wf([p("x", "text", true)])]])),
    ).toThrow("approval-flow-dify-params");
    expect(compileDef({ steps: [review("a", G.l1)] }, ALL).inputs.map((i) => i.key)).toEqual([
      "contract-id",
    ]);
  });
  it("S3b · head_only vào stage review (chỉ khi bật), qua bộ kiểm engine", () => {
    const a = { ...review("a", G.l1), head_only: true } as FlowStep;
    const b = { ...review("b", G.l1), head_only: false } as FlowStep;
    const def = compileDef({ steps: [a, b] }, ALL);
    const after = (i: number) => def.stages[i]?.after as unknown as Record<string, unknown>;
    expect(after(0).head_only).toBe(true);
    expect(Object.keys(after(2))).not.toContain("head_only");
    expect(engineIssues(def)).toEqual([]);
  });
  it("8 bước (tối đa) và 1 bước: vẫn ≤ 10 stage, qua bộ kiểm engine", () => {
    const eight = Array.from({ length: 8 }, (_, i) => review(`k${i}`, G.l1));
    expect(compileDef({ steps: eight }, ALL).stages.length).toBe(10);
    expect(engineIssues(compileDef({ steps: eight }, ALL))).toEqual([]);
    expect(engineIssues(compileDef({ steps: [review("only", G.l1)] }, ALL))).toEqual([]);
  });
  it("Group không còn ở tenant ⇒ ném", () => {
    expect(() => compileDef({ steps: FOUR }, new Set([G.l1]))).toThrow(
      "approval-flow-group-missing",
    );
  });
});
