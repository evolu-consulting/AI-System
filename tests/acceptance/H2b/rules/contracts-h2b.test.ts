// HUB-FR-91 · HUB-FR-92 · HUB-FR-94 · WRK-FR-03 · WRK-FR-15 · contract H2b: chat chỉ thêm, hub `job.delta`/`stream`/
// `refused` (test-plan H2b §4 R40–R44, cases §1.10; spec §3, plan §2).
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AgentMenuItemSchema,
  AgentMenuResponseSchema,
  AgentNotFoundDetailsSchema,
  CHAT_API_ERRORS,
  CHAT_COMMAND_ERRORS,
  CHAT_EVENT_NAMES,
  CHAT_ROUTING_ERRORS,
  CHAT_RUN_ERROR_CODES,
  MessageSchema,
  RETRY_AFTER_HEADER,
  RunStartedDataSchema,
  TOO_MANY_RUNS_RETRY_AFTER_S,
} from "@ai/contracts/chat";
import { JOB_FAIL_REASONS, JobPayloadSchema, RunEventSchema } from "@ai/contracts/hub";
import { uid } from "./_access";

const FIXTURES = resolve(import.meta.dir, "../../../../packages/contracts/fixtures/hub");
const readJson = (kind: "valid" | "invalid", f: string): unknown =>
  JSON.parse(readFileSync(resolve(FIXTURES, kind, f), "utf8"));
const listFixtures = (kind: "valid" | "invalid", prefix: string): string[] =>
  readdirSync(resolve(FIXTURES, kind)).filter(
    (f) => f.startsWith(`${prefix}.`) && f.endsWith(".json"),
  );
const SCHEMAS = { RunEvent: RunEventSchema, JobPayload: JobPayloadSchema } as const;
const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown): boolean =>
  schema.safeParse(v).success;

const ITEM = {
  key: "assistant",
  name: { vi: "Trợ lý", en: "Assistant" },
  description: "a".repeat(20),
};
const AT = "2026-10-05T01:00:00.000Z";
const message = (role: "user" | "assistant", extra: Record<string, unknown> = {}) => ({
  id: uid(501),
  conversation_id: uid(502),
  flow_id: uid(503),
  role,
  content: "xin chào",
  run_id: null,
  created_at: AT,
  run: null,
  ask: null,
  ...extra,
});
const RESPONDER = { key: "assistant", name: "Trợ lý" };
const delta = {
  v: 1,
  job_id: uid(601),
  seq: 1,
  at: AT,
  type: "job.delta",
  kind: "answer",
  text: "x",
};

describe("HUB-FR-92 · contract chat H2b chỉ thêm [R40–R42]", () => {
  it("HUB-FR-92 · R40 · AgentMenuItem strict, mô tả 20–400, key regex; menu ≤ 500 [spec §3]", () => {
    expect(ok(AgentMenuItemSchema, ITEM)).toBe(true);
    expect(ok(AgentMenuItemSchema, { ...ITEM, id: uid(1) })).toBe(false);
    expect(ok(AgentMenuItemSchema, { ...ITEM, description: "a".repeat(19) })).toBe(false);
    expect(ok(AgentMenuItemSchema, { ...ITEM, description: "a".repeat(401) })).toBe(false);
    expect(ok(AgentMenuItemSchema, { ...ITEM, description: "a".repeat(400) })).toBe(true);
    expect(ok(AgentMenuItemSchema, { ...ITEM, key: "Bad Key" })).toBe(false);
    expect(ok(AgentMenuResponseSchema, { items: Array(500).fill(ITEM) })).toBe(true);
    expect(ok(AgentMenuResponseSchema, { items: Array(501).fill(ITEM) })).toBe(false);
  });

  it("HUB-FR-91 · HUB-FR-94 · R41 · lỗi định tuyến riêng; mã/sự kiện cũ không đổi; Retry-After 5 [spec §3]", () => {
    expect(CHAT_ROUTING_ERRORS).toEqual({ AGENT_NOT_FOUND: 404, TOO_MANY_RUNS: 429 });
    expect(Object.keys(CHAT_API_ERRORS).sort()).toEqual([
      "AUTH_EXPIRED",
      "EVENTS_EXPIRED",
      "FLOW_BUSY",
      "INTERNAL_ERROR",
      "NOT_FOUND",
      "VALIDATION_ERROR",
    ]);
    expect(CHAT_COMMAND_ERRORS).toEqual({ CMD_NOT_FOUND: 404, CMD_MISSING_ARG: 422 });
    expect(CHAT_RUN_ERROR_CODES).toHaveLength(7);
    expect([...CHAT_EVENT_NAMES]).toEqual([
      "run.started",
      "step.started",
      "step.finished",
      "delta",
      "ask",
      "run.finished",
      "run.failed",
    ]);
    expect(RETRY_AFTER_HEADER).toBe("Retry-After");
    expect(TOO_MANY_RUNS_RETRY_AFTER_S).toBe(5);
    expect(ok(AgentNotFoundDetailsSchema, { suggestions: ["a", "b", "c"] })).toBe(true);
    expect(ok(AgentNotFoundDetailsSchema, { suggestions: ["a", "b", "c", "d"] })).toBe(false);
  });

  it("HUB-FR-91 · R42 · responder chỉ ở tin assistant, optional không nullable; run.started có/không [spec §3]", () => {
    expect(ok(MessageSchema, message("assistant", { responder: RESPONDER }))).toBe(true);
    expect(ok(MessageSchema, message("assistant"))).toBe(true);
    expect(ok(MessageSchema, message("user"))).toBe(true);
    expect(ok(MessageSchema, message("user", { responder: RESPONDER }))).toBe(false);
    expect(ok(MessageSchema, message("assistant", { responder: null }))).toBe(false);
    const started = { run_id: uid(504), flow_id: uid(503), quota: { state: "ok", pct: 0 } };
    expect(ok(RunStartedDataSchema, started)).toBe(true);
    expect(ok(RunStartedDataSchema, { ...started, responder: RESPONDER })).toBe(true);
  });
});

describe("WRK-FR-03 · contract hub H2b [R43–R44]", () => {
  it("WRK-FR-03 · R43 · fixture mới/cũ valid parse, invalid lỗi; text đếm code point ≤ 4000 [spec §3]", () => {
    for (const [prefix, schema] of Object.entries(SCHEMAS)) {
      for (const f of listFixtures("valid", prefix))
        expect([f, ok(schema, readJson("valid", f))]).toEqual([f, true]);
    }
    const valid = [
      "RunEvent.delta-answer.json",
      "RunEvent.delta-partial.json",
      "JobPayload.agent-stream.json",
    ];
    for (const f of valid) expect(listFixtures("valid", f.split(".")[0] ?? "")).toContain(f);
    const invalid: [string, keyof typeof SCHEMAS][] = [
      ["RunEvent.delta-4001.json", "RunEvent"],
      ["RunEvent.delta-bad-kind.json", "RunEvent"],
      ["RunEvent.delta-empty.json", "RunEvent"],
      ["JobPayload.stream-string.json", "JobPayload"],
    ];
    for (const [f, s] of invalid)
      expect([f, ok(SCHEMAS[s], readJson("invalid", f))]).toEqual([f, false]);
    expect(ok(RunEventSchema, { ...delta, text: "😀".repeat(4000) })).toBe(true);
    expect(ok(RunEventSchema, { ...delta, text: "😀".repeat(4001) })).toBe(false);
  });

  it("WRK-FR-15 · R44 · refused ∈ JOB_FAIL_REASONS; RunEvent nhận job.delta; AgentCliJob thiếu stream ok [spec §3]", () => {
    expect(JOB_FAIL_REASONS).toContain("refused");
    expect(ok(RunEventSchema, delta)).toBe(true);
    const agent = readJson("valid", "JobPayload.agent.json") as Record<string, unknown>;
    expect("stream" in agent).toBe(false);
    expect(ok(JobPayloadSchema, agent)).toBe(true);
    expect(ok(JobPayloadSchema, { ...agent, stream: true })).toBe(true);
  });
});
