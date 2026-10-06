// HUB-FR-78 · HUB-FR-79 · HUB-FR-52 · ADM-FR-37 · H3b-R21 · spec §3 · plan §2 · test-plan-cases H3b §1.5 R60–R66: contract
// `@ai/contracts/hub-admin` (mã lỗi riêng, không lẫn CHAT_API_ERRORS; schema strict, refine). Xanh trước code (C1 có).
import { describe, expect, it } from "bun:test";
import { CHAT_API_ERRORS } from "@ai/contracts/chat";
import {
  AGENT_MISSING,
  AgentGrantCreateSchema,
  AgentGrantListQuerySchema,
  EffectiveAgentSchema,
  HUB_ADMIN_ERRORS,
  InvalidReferenceDetailsSchema,
  NotEntitledDetailsSchema,
  RunTraceSchema,
  TraceJobSchema,
} from "@ai/contracts/hub-admin";

const ID = "a3b00000-0000-4000-8000-000000000501";
const ID2 = "a3b00000-0000-4000-8000-000000000502";
const AT = "2026-10-06T08:00:00.000Z";
const ok = (s: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) =>
  s.safeParse(v).success;

const job = {
  id: ID,
  step_id: ID2,
  type: "agent.cli",
  provider_key: "fake-cli",
  status: "succeeded",
  attempts: 1,
  error_code: null,
  error_reason: null,
  created_at: AT,
  started_at: AT,
  finished_at: AT,
};
const usage = (cost: string | null) => ({
  model: null,
  input_tokens: 1,
  output_tokens: 2,
  cost_usd: cost,
  billable_usd: null,
});
const trace = (extra: Record<string, unknown> = {}, cost: string | null = "0.0012") => ({
  run: {
    id: ID,
    tenant_id: ID2,
    user_id: ID2,
    kind: "orchestrated",
    status: "finished",
    error_code: null,
    error_message: null,
    config_version: 1,
    conversation_id: ID,
    flow_id: ID,
    tokens_used: 3,
    started_at: AT,
    finished_at: AT,
  },
  messages: { user: null, answer: null },
  steps: [],
  jobs: [job],
  usage_total: usage(cost),
  truncated: false,
  ...extra,
});

describe("contract @ai/contracts/hub-admin [HUB-FR-78 · H3b-R21]", () => {
  it("HUB-FR-78 · R60 · HUB_ADMIN_ERRORS đúng 5 mã + status [H3b-R21 · PL1]", () => {
    expect(HUB_ADMIN_ERRORS).toEqual({
      FORBIDDEN: 403,
      TENANT_REQUIRED: 400,
      INVALID_REFERENCE: 400,
      NOT_ENTITLED: 409,
      AGENT_NOT_GRANTABLE: 409,
    });
  });

  it("HUB-FR-78 · R61 · CHAT_API_ERRORS vẫn 6 mã, không chứa 5 mã mới [H3b-R21 · PL1]", () => {
    expect(Object.keys(CHAT_API_ERRORS).length).toBe(6);
    for (const c of Object.keys(HUB_ADMIN_ERRORS))
      expect(Object.keys(CHAT_API_ERRORS)).not.toContain(c);
  });

  it("ADM-FR-37 · R62 · AgentGrantCreateSchema: tenant_id trong body · subject_type role · subject_id không uuid ⇒ lỗi; hợp lệ ⇒ ok [H3b-R02, R04]", () => {
    const good = { agent_id: ID, subject_type: "group", subject_id: ID2 };
    expect(ok(AgentGrantCreateSchema, good)).toBe(true);
    expect(ok(AgentGrantCreateSchema, { ...good, tenant_id: ID })).toBe(false);
    expect(ok(AgentGrantCreateSchema, { ...good, subject_type: "role" })).toBe(false);
    expect(ok(AgentGrantCreateSchema, { ...good, subject_id: "x" })).toBe(false);
  });

  it("ADM-FR-37 · R63 · AgentGrantListQuerySchema: chỉ subject_type / chỉ subject_id ⇒ lỗi; cả hai / cả vắng ⇒ ok; khoá lạ ⇒ lỗi [H3b-R11]", () => {
    expect(ok(AgentGrantListQuerySchema, { subject_type: "group" })).toBe(false);
    expect(ok(AgentGrantListQuerySchema, { subject_id: ID })).toBe(false);
    expect(ok(AgentGrantListQuerySchema, { subject_type: "user", subject_id: ID })).toBe(true);
    expect(ok(AgentGrantListQuerySchema, {})).toBe(true);
    expect(ok(AgentGrantListQuerySchema, { tenant_id: ID })).toBe(true);
    expect(ok(AgentGrantListQuerySchema, { foo: "1" })).toBe(false);
  });

  it("HUB-FR-79 · R64 · EffectiveAgentSchema: visible true + missing [no_grant] ⇒ lỗi; AGENT_MISSING nguyên văn thứ tự R14 [H3b-R14]", () => {
    const agent = { id: ID, key: "hoadon", name: { vi: "Hoá đơn", en: "Invoice" } };
    const base = { agent, reasons: [{ code: "grant_user" }] };
    expect(ok(EffectiveAgentSchema, { ...base, visible: true, missing: ["no_grant"] })).toBe(false);
    expect(ok(EffectiveAgentSchema, { ...base, visible: false, missing: ["no_grant"] })).toBe(true);
    expect(ok(EffectiveAgentSchema, { ...base, visible: true, missing: [] })).toBe(true);
    expect([...AGENT_MISSING]).toEqual([
      "user_inactive",
      "tenant_locked",
      "agent_disabled",
      "runtime_unavailable",
      "no_entitlement",
      "no_grant",
    ]);
  });

  it('HUB-FR-52 · R65 · RunTraceSchema/TraceJob strict: thêm payload/result/token_hash ⇒ lỗi; cost_usd "0.0012" ok, "1e-3" lỗi [H3b-R18]', () => {
    expect(ok(RunTraceSchema, trace())).toBe(true);
    for (const k of ["payload", "result", "token_hash"]) {
      expect(ok(TraceJobSchema, { ...job, [k]: "x" })).toBe(false);
      expect(ok(RunTraceSchema, trace({ jobs: [{ ...job, [k]: "x" }] }))).toBe(false);
    }
    expect(ok(RunTraceSchema, trace({ extra: 1 }))).toBe(false);
    expect(ok(RunTraceSchema, trace({}, "1e-3"))).toBe(false);
  });

  it("HUB-FR-78 · R66 · NotEntitledDetails agent_ids 0 / 2 phần tử ⇒ lỗi; InvalidReferenceDetails field tenant_id ⇒ lỗi [H3b-R04 · PL12]", () => {
    expect(ok(NotEntitledDetailsSchema, { agent_ids: [] })).toBe(false);
    expect(ok(NotEntitledDetailsSchema, { agent_ids: [ID, ID2] })).toBe(false);
    expect(ok(NotEntitledDetailsSchema, { agent_ids: [ID] })).toBe(true);
    expect(ok(InvalidReferenceDetailsSchema, { field: "tenant_id" })).toBe(false);
    expect(ok(InvalidReferenceDetailsSchema, { field: "subject_id" })).toBe(true);
  });
});
