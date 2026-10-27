// esign-flow · luật thuần: bước Ký số (tối đa 1, cuối luồng, người ký đủ), người duyệt cụ thể (thay phòng), bước engine bỏ Ký số,
// def engine mang cửa `approver_user_id` và qua được bộ kiểm def của engine.
import { describe, expect, it } from "bun:test";
import * as C from "@ai/contracts";
import { ProcessDefInputSchema } from "@ai/contracts/hub-admin";
import {
  compileDef,
  engineSteps,
  esignStepOf,
  flowGroupIds,
  flowUserIds,
  validateFlow,
} from "./approval-flow.rules";
import type { FlowEsignStep, FlowStep } from "./approval-flow.types";

const G = {
  l1: "00000000-0000-4000-8000-000000000001",
  own: "00000000-0000-4000-8000-000000000002",
  law: "00000000-0000-4000-8000-000000000003",
};
const U = "00000000-0000-4000-8000-0000000000a1";
const ALL = new Set(Object.values(G));

const review = (key: string, o: Partial<Extract<FlowStep, { kind: "review" }>> = {}): FlowStep => ({
  kind: "review",
  key,
  name: key,
  department_group_id: G.l1,
  head_only: false,
  due_h: 48,
  remind_every_h: null,
  escalate_group_id: null,
  exclude_starter: false,
  when: null,
  ...o,
});
const esign = (key = "sign", o: Partial<FlowEsignStep> = {}): FlowEsignStep => ({
  kind: "esign",
  key,
  name: "Ký số",
  company_signer: { mode: "owner" },
  partner_signs: true,
  order: "company_first",
  provider: null,
  due_h: 72,
  remind_every_h: 24,
  escalate_group_id: null,
  ...o,
});
const rules = (steps: FlowStep[]) => validateFlow(steps).map((i) => `${i.path}:${i.rule}`);

describe("esign-flow · kiểm bước Ký số", () => {
  it("bước Ký số cuối, người ký mặc định ⇒ hợp lệ; DTO zod nhận", () => {
    const steps = [review("a"), esign()];
    expect(rules(steps)).toEqual([]);
    expect(C.FlowStepsSchema.safeParse(steps).success).toBe(true);
  });
  it("Ký số không ở cuối ⇒ ESIGN_NOT_LAST; hai bước Ký số ⇒ ESIGN_MULTI", () => {
    expect(rules([review("a"), esign(), review("b")])).toContain("steps.1:ESIGN_NOT_LAST");
    expect(rules([review("a"), esign("s1"), esign("s2")])).toEqual(
      expect.arrayContaining(["steps.1:ESIGN_NOT_LAST", "steps.2:ESIGN_MULTI"]),
    );
  });
  it("Ký số đứng đầu ⇒ FIRST_NOT_REVIEW", () => {
    expect(rules([esign()])).toContain("steps.0.kind:FIRST_NOT_REVIEW");
  });
  it("người ký trưởng phòng thiếu phòng / người cụ thể thiếu người ⇒ lỗi; hạn ngoài giới hạn ⇒ DUE_RANGE", () => {
    const dh = esign("x", { company_signer: { mode: "dept_head" } });
    expect(rules([review("a"), dh])).toContain(
      "steps.1.company_signer.department_group_id:SIGNER_GROUP_REQUIRED",
    );
    const us = esign("x", { company_signer: { mode: "user", user_id: null } });
    expect(rules([review("a"), us])).toContain(
      "steps.1.company_signer.user_id:SIGNER_USER_REQUIRED",
    );
    expect(rules([review("a"), esign("x", { due_h: 1 })])).toContain("steps.1.due_h:DUE_RANGE");
  });
  it("phòng người ký vào danh sách Group kiểm; người cụ thể vào danh sách user kiểm", () => {
    const steps = [
      review("a", { approver_user_id: U, department_group_id: null }),
      esign("x", { company_signer: { mode: "dept_head", department_group_id: G.law } }),
    ];
    expect(flowGroupIds(steps)).toEqual([G.law]);
    expect(flowUserIds(steps)).toEqual([{ path: "steps.0.approver_user_id", id: U }]);
    const u2 = [review("a"), esign("x", { company_signer: { mode: "user", user_id: U } })];
    expect(flowUserIds(u2)).toEqual([{ path: "steps.1.company_signer.user_id", id: U }]);
  });
});

describe("esign-flow · người duyệt cụ thể + def engine", () => {
  it("người duyệt cụ thể thay phòng: không phòng vẫn hợp lệ (không GROUP_REQUIRED)", () => {
    expect(rules([review("a", { approver_user_id: U, department_group_id: null })])).toEqual([]);
    expect(rules([review("a", { department_group_id: null })])).toContain(
      "steps.0.department_group_id:GROUP_REQUIRED",
    );
  });
  it("bước engine bỏ Ký số; esignStepOf trả bước cuối", () => {
    const steps = [review("a"), review("b"), esign()];
    expect(engineSteps(steps).map((s) => s.key)).toEqual(["a", "b"]);
    expect(esignStepOf(steps)?.key).toBe("sign");
    expect(esignStepOf([review("a")])).toBeNull();
  });
  it("def: không stage cho Ký số; stage người cụ thể mang approver_user_id, Group = Toàn quyền khi không phòng", () => {
    const steps = [
      review("a"),
      review("b", { approver_user_id: U, department_group_id: null }),
      esign(),
    ];
    const def = compileDef({ steps }, ALL, new Map(), [G.own]);
    expect(def.stages.map((s) => s.key)).toEqual(["s0", "route", "s1", "finalize"]);
    const s1 = def.stages.find((s) => s.key === "s1")?.after as Record<string, unknown>;
    expect(s1).toMatchObject({ group_id: G.own, approver_user_id: U, also_group_ids: [G.own] });
    expect(ProcessDefInputSchema.safeParse(def).success).toBe(true);
  });
});
