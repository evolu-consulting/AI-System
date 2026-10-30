// CR-105 · pl-slot-shape · `fromStages` nghịch `compileDef`, dạng song song bị chặn, xem trước đường đi.
import { describe, expect, it } from "bun:test";
import { compileDef } from "./approval-flow.rules";
import type { FlowStep } from "./approval-flow.types";
import { fromStages, previewPath, type StageLike } from "./approval-flow-stages.rules";

const G1 = "00000000-0000-4000-8000-000000000001";
const G2 = "00000000-0000-4000-8000-000000000002";
const GROUPS = new Set([G1, G2]);

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

const FLOW: { steps: FlowStep[] } = {
  steps: [
    review("a", G1),
    { kind: "dify", key: "scan", name: "scan", workflow_key: "risk-scan", after: "auto" },
    review("b", G2, {
      exclude_starter: true,
      when: {
        op: "or",
        conds: [
          { field: "total_value", op: "ge", value: 1_000_000_000 },
          { field: "deal", in: ["buy"] },
        ],
      },
    }),
    {
      kind: "esign",
      key: "sign",
      name: "Ký số",
      company_signer: { mode: "owner" },
      partner_signs: true,
      order: "company_first",
      provider: null,
      due_h: 72,
      remind_every_h: null,
      escalate_group_id: null,
    },
  ],
};

describe("approval-flow-stages", () => {
  it("fromStages nghịch compileDef", () => {
    const wf = new Map([["risk-scan", { key: "risk-scan", name: "r", params: [] }]]);
    const def = compileDef(FLOW, GROUPS, wf);
    const r = fromStages(def.stages as unknown as StageLike[]);
    expect(r).toEqual({ ok: true, steps: FLOW.steps });
    // không esign ⇒ không có nút đuôi
    const noSign = { steps: FLOW.steps.slice(0, 3) };
    const r2 = fromStages(compileDef(noSign, GROUPS, wf).stages as unknown as StageLike[]);
    expect(r2).toEqual({ ok: true, steps: noSign.steps });
  });

  it("dạng song song ⇒ SLOT_SHAPE_UNSUPPORTED", () => {
    const wf = new Map([["risk-scan", { key: "risk-scan", name: "r", params: [] }]]);
    const stages = compileDef({ steps: FLOW.steps.slice(0, 3) }, GROUPS, wf)
      .stages as unknown as StageLike[];
    // s2 chạy song song với s1 (cùng bước engine)
    const par = stages.map((s) => (s.key === "s2" ? { ...s, step: 2 } : s));
    expect(fromStages(par)).toEqual({ ok: false, error: "SLOT_SHAPE_UNSUPPORTED", stage: "s2" });
    // stage If giữa chuỗi
    const withIf = stages.map((s) =>
      s.key === "s1" ? { ...s, executor: { kind: "if" }, slot: undefined } : s,
    );
    expect(fromStages(withIf)).toMatchObject({ ok: false, stage: "s1" });
  });

  it("previewPath: bước chạy / bỏ qua theo loại HĐ và giá trị", () => {
    const run = (contractType: "buy" | "sell" | null, value: unknown) =>
      previewPath(FLOW, { contractType, value }).map((s) => s.run);
    expect(run("sell", 10)).toEqual([true, true, false, true]);
    expect(run("buy", 10)).toEqual([true, true, true, true]);
    expect(run("sell", 2_000_000_000)).toEqual([true, true, true, true]);
    expect(run(null, null)).toEqual([true, true, true, true]); // dữ liệu trống ⇒ cần bước
  });
});
