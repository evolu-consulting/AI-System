// HUB-H1-AC-06 · HUB-FR-89 · contract `@ai/contracts/hub` (test-plan H1 §4 R14; plan §2.5–2.6).
import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CHAT_RUN_ERROR_CODES } from "@ai/contracts/chat";
import {
  HUB_JOB_ERROR_CODES,
  HUB_JSON_SCHEMAS,
  type HubJsonSchemaName,
  JobPayloadSchema,
  RunEventSchema,
} from "@ai/contracts/hub";

const U = "11111111-1111-4111-8111-111111111111";
const FIXTURES = resolve(import.meta.dir, "../../../../packages/contracts/fixtures/hub");

const job = {
  v: 1,
  type: "agent.cli",
  runtime: "agentic-cli",
  job_id: U,
  run_id: U,
  step_id: U,
  tenant_id: U,
  user_id: U,
  conversation_id: U,
  flow_id: U,
  feature_id: null,
  agent_type_key: null,
  mcp: null,
  agent: { id: U, key: "orchestrator", role: "orchestrator" },
  provider_key: "claude-code",
  model: null,
  step_index: 0,
  max_turns: 3,
  profile_steps: [{ provider_key: "claude-code", model: null, on: [] }],
  system_prompt: "",
  prompt: "xin chào",
  history: [{ role: "user", content: "chào" }],
  use_session: false,
  allowed_tools: [],
  output: "text",
  timeout_s: 600,
};
const started = {
  v: 1,
  job_id: U,
  seq: 1,
  at: "2026-10-04T08:00:00.000+07:00",
  type: "job.started",
  worker_id: "w-1",
  provider_key: "claude-code",
};

/** Mẫu C2: `fixtures/hub/<valid|invalid>/<Tên schema>[._-]*.json`, tên = key của HUB_JSON_SCHEMAS. */
function fixtures(kind: "valid" | "invalid", name: string): unknown[] {
  const dir = join(FIXTURES, kind);
  if (!existsSync(dir)) return [];
  const re = new RegExp(`^${name}[._-].*\\.json$`);
  return readdirSync(dir)
    .filter((f) => re.test(f))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as unknown);
}

describe("R14 · contract hub [HUB-H1-AC-06]", () => {
  it("R14 · HUB_JOB_ERROR_CODES ⊂ CHAT_RUN_ERROR_CODES [HUB-FR-89]", () => {
    const chat: readonly string[] = CHAT_RUN_ERROR_CODES;
    for (const code of HUB_JOB_ERROR_CODES) expect(chat).toContain(code);
  });

  it("R14 · toJSONSchema throw-mode không ném với mọi schema xuất [HUB-H1-AC-06]", () => {
    expect(Object.keys(HUB_JSON_SCHEMAS).length).toBeGreaterThanOrEqual(8);
    for (const s of Object.values(HUB_JSON_SCHEMAS)) {
      expect(() =>
        s.toJSONSchema({ target: "draft-2020-12", io: "output", unrepresentable: "throw" }),
      ).not.toThrow();
    }
  });

  it("R14 · mẫu hợp lệ nhận, v:2 bị từ chối [HUB-FR-89 · HUB-H1-AC-06]", () => {
    expect(JobPayloadSchema.safeParse(job).success).toBe(true);
    expect(RunEventSchema.safeParse(started).success).toBe(true);
    expect(JobPayloadSchema.safeParse({ ...job, v: 2 }).success).toBe(false);
    expect(RunEventSchema.safeParse({ ...started, v: 2 }).success).toBe(false);
  });

  it("R14 · fixtures C2: mỗi schema ≥ 2 valid (zod nhận) + ≥ 2 invalid (zod từ chối) [HUB-H1-AC-06]", () => {
    for (const name of Object.keys(HUB_JSON_SCHEMAS) as HubJsonSchemaName[]) {
      const schema = HUB_JSON_SCHEMAS[name];
      const valid = fixtures("valid", name);
      const invalid = fixtures("invalid", name);
      expect({ name, valid: valid.length >= 2, invalid: invalid.length >= 2 }).toEqual({
        name,
        valid: true,
        invalid: true,
      });
      for (const v of valid)
        expect({ name, ok: schema.safeParse(v).success }).toEqual({ name, ok: true });
      for (const v of invalid) {
        expect({ name, ok: schema.safeParse(v).success }).toEqual({ name, ok: false });
      }
    }
  });
});
