import { describe, expect, test } from "bun:test";
import {
  AGENT_GRANTS_PER_AGENT_MAX,
  AGENT_MISSING,
  AgentGrantCreateSchema,
  AgentGrantDeleteQuerySchema,
  AgentGrantListQuerySchema,
  AgentGrantListResponseSchema,
  AgentGrantWriteResponseSchema,
  DecimalStringSchema,
  EffectiveAgentSchema,
  EffectiveAgentsResponseSchema,
  ErrorResponseSchema,
  HUB_ADMIN_ERRORS,
  InvalidReferenceDetailsSchema,
  NotEntitledDetailsSchema,
  RunTraceSchema,
  TRACE_JOBS_MAX,
  TRACE_STEPS_MAX,
} from "./index";

const U = "11111111-1111-4111-8111-111111111111";
const V = "22222222-2222-4222-8222-222222222222";
const AT = "2026-10-06T00:00:00.000Z";
const agent = { id: U, key: "researcher", name: { vi: "Nghiên cứu", en: "Researcher" } };
const group = { id: V, key: "beta-testers", name: { vi: "Beta" }, is_beta: true };
const row = { id: U, subject: { type: "group", group }, granted_by: "admin", granted_at: AT };
const ok = (s: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) =>
  s.safeParse(v).success;

describe("HUB-FR-78 · hub-admin errors", () => {
  test("HUB-FR-78 · mã lỗi → status, body ErrorResponse", () => {
    expect(HUB_ADMIN_ERRORS).toEqual({
      FORBIDDEN: 403,
      TENANT_REQUIRED: 400,
      INVALID_REFERENCE: 400,
      NOT_ENTITLED: 409,
      AGENT_NOT_GRANTABLE: 409,
    });
    for (const code of Object.keys(HUB_ADMIN_ERRORS)) {
      expect(ok(ErrorResponseSchema, { error: { code, message: "m" } })).toBe(true);
    }
  });

  test("HUB-FR-78 · details INVALID_REFERENCE / NOT_ENTITLED", () => {
    expect(ok(InvalidReferenceDetailsSchema, { field: "agent_id" })).toBe(true);
    expect(ok(InvalidReferenceDetailsSchema, { field: "tenant_id" })).toBe(false);
    expect(ok(NotEntitledDetailsSchema, { agent_ids: [U] })).toBe(true);
    expect(ok(NotEntitledDetailsSchema, { agent_ids: [] })).toBe(false);
    expect(ok(NotEntitledDetailsSchema, { agent_ids: [U, V] })).toBe(false);
  });
});

describe("HUB-FR-78 · /agent-grants request", () => {
  test("HUB-FR-78 · body strict — tenant_id trong body bị từ chối", () => {
    const b = { agent_id: U, subject_type: "user", subject_id: V };
    expect(ok(AgentGrantCreateSchema, b)).toBe(true);
    expect(ok(AgentGrantCreateSchema, { ...b, tenant_id: U })).toBe(false);
    expect(ok(AgentGrantCreateSchema, { ...b, subject_type: "role" })).toBe(false);
    expect(ok(AgentGrantDeleteQuerySchema, { ...b, tenant_id: U })).toBe(true);
    expect(ok(AgentGrantDeleteQuerySchema, { tenant_id: U, agent_id: U })).toBe(false);
  });

  test("HUB-FR-78 · list query: subject_type và subject_id cùng có hoặc cùng vắng", () => {
    expect(ok(AgentGrantListQuerySchema, {})).toBe(true);
    expect(ok(AgentGrantListQuerySchema, { subject_type: "group", subject_id: V })).toBe(true);
    expect(ok(AgentGrantListQuerySchema, { subject_type: "group" })).toBe(false);
    expect(ok(AgentGrantListQuerySchema, { subject_id: V })).toBe(false);
    expect(ok(AgentGrantListQuerySchema, { q: "x" })).toBe(false);
  });
});

describe("HUB-FR-78 · /agent-grants response", () => {
  test("HUB-FR-78 · write response; GroupRef is_beta ⇔ key beta-testers", () => {
    const grant = {
      id: U,
      tenant_id: V,
      agent,
      subject: row.subject,
      granted_by: null,
      granted_at: AT,
    };
    expect(ok(AgentGrantWriteResponseSchema, { grant, hub_config_version: 3 })).toBe(true);
    expect(ok(AgentGrantWriteResponseSchema, { grant, hub_config_version: -1 })).toBe(false);
    const bad = { ...grant, subject: { type: "group", group: { ...group, is_beta: false } } };
    expect(ok(AgentGrantWriteResponseSchema, { grant: bad, hub_config_version: 3 })).toBe(false);
    const noEn = { ...grant, agent: { ...agent, name: { vi: "x" } } };
    expect(ok(AgentGrantWriteResponseSchema, { grant: noEn, hub_config_version: 3 })).toBe(false);
  });

  test("HUB-FR-78 · list response: grants ≤ 500 mỗi agent, items ≤ 200", () => {
    const item = (n: number) => ({
      agent: { ...agent, description: "d", enabled: true, runnable: false },
      grants: Array.from({ length: n }, () => row),
      grants_total: n,
    });
    const res = (items: unknown[]) => ({
      tenant_id: U,
      items,
      truncated: false,
      hub_config_version: 0,
    });
    expect(ok(AgentGrantListResponseSchema, res([item(AGENT_GRANTS_PER_AGENT_MAX)]))).toBe(true);
    expect(ok(AgentGrantListResponseSchema, res([item(AGENT_GRANTS_PER_AGENT_MAX + 1)]))).toBe(
      false,
    );
    expect(ok(AgentGrantListResponseSchema, res(Array.from({ length: 200 }, () => item(0))))).toBe(
      true,
    );
    expect(ok(AgentGrantListResponseSchema, res(Array.from({ length: 201 }, () => item(0))))).toBe(
      false,
    );
  });
});

describe("HUB-FR-79 · effective", () => {
  const ea = (visible: boolean, missing: string[]) => ({ agent, visible, reasons: [], missing });

  test("HUB-FR-79 · visible ⇔ missing = []", () => {
    expect(ok(EffectiveAgentSchema, ea(true, []))).toBe(true);
    expect(ok(EffectiveAgentSchema, ea(false, ["no_grant"]))).toBe(true);
    expect(ok(EffectiveAgentSchema, ea(true, ["no_grant"]))).toBe(false);
    expect(ok(EffectiveAgentSchema, ea(false, []))).toBe(false);
    expect(ok(EffectiveAgentSchema, ea(false, ["feature_off"]))).toBe(false);
  });

  test("HUB-FR-79 · thứ tự missing cố định, reasons grant_user/grant_group", () => {
    expect(AGENT_MISSING).toEqual([
      "user_inactive",
      "tenant_locked",
      "agent_disabled",
      "runtime_unavailable",
      "no_entitlement",
      "no_grant",
    ]);
    const reasons = [{ code: "grant_user" }, { code: "grant_group", group }];
    expect(ok(EffectiveAgentSchema, { ...ea(true, []), reasons })).toBe(true);
    expect(ok(EffectiveAgentSchema, { ...ea(true, []), reasons: [{ code: "core" }] })).toBe(false);
    const res = (n: number) => ({
      user: { id: U, tenant_id: V },
      agents: Array.from({ length: n }, () => ea(true, [])),
      hub_config_version: 1,
    });
    expect(ok(EffectiveAgentsResponseSchema, res(200))).toBe(true);
    expect(ok(EffectiveAgentsResponseSchema, res(201))).toBe(false);
  });
});

const usage = {
  model: null,
  input_tokens: 1,
  output_tokens: 2,
  cost_usd: "0.001",
  billable_usd: null,
};
const step = {
  id: U,
  seq: 1,
  type: "delegate",
  agent: { id: V, key: "researcher" },
  workflow_id: null,
  provider_key: "claude",
  job_id: V,
  label_key: "trace.delegate",
  status: "done",
  started_at: AT,
  finished_at: AT,
  ms: 10,
  detail: { k: 1 },
  usage: { ...usage, model: "m" },
};
const job = {
  id: V,
  step_id: U,
  type: "cli",
  provider_key: "claude",
  status: "done",
  attempts: 1,
  error_code: null,
  error_reason: null,
  created_at: AT,
  started_at: null,
  finished_at: null,
};
const run = {
  id: U,
  tenant_id: V,
  user_id: U,
  kind: "orchestrated",
  status: "done",
  error_code: null,
  error_message: null,
  config_version: 1,
  conversation_id: U,
  flow_id: V,
  tokens_used: 3,
  started_at: AT,
  finished_at: null,
};
const trace = (steps: unknown[], jobs: unknown[]) => ({
  run,
  messages: { user: { id: U, content: "hi", created_at: AT }, answer: null },
  steps,
  jobs,
  usage_total: usage,
  truncated: false,
});

describe("HUB-FR-52 · trace", () => {
  test("HUB-FR-52 · RunTrace hợp lệ, strict, không nhận trường payload", () => {
    expect(ok(RunTraceSchema, trace([step], [job]))).toBe(true);
    expect(ok(RunTraceSchema, trace([step], [{ ...job, payload: {} }]))).toBe(false);
    expect(ok(RunTraceSchema, trace([{ ...step, type: "llm" }], []))).toBe(false);
    expect(ok(RunTraceSchema, { ...trace([], []), usage_total: { ...usage, model: "m" } })).toBe(
      false,
    );
  });

  test("HUB-FR-52 · steps/jobs ≤ 200", () => {
    const n = (k: number, v: unknown) => Array.from({ length: k }, () => v);
    expect(ok(RunTraceSchema, trace(n(TRACE_STEPS_MAX, step), n(TRACE_JOBS_MAX, job)))).toBe(true);
    expect(ok(RunTraceSchema, trace(n(TRACE_STEPS_MAX + 1, step), []))).toBe(false);
    expect(ok(RunTraceSchema, trace([], n(TRACE_JOBS_MAX + 1, job)))).toBe(false);
  });

  test("HUB-FR-52 · DecimalString", () => {
    for (const v of ["0", "12.5", "-0.000001"]) expect(ok(DecimalStringSchema, v)).toBe(true);
    for (const v of ["", "1.", ".5", "1e3", "1,5", " 1"])
      expect(ok(DecimalStringSchema, v)).toBe(false);
  });
});
