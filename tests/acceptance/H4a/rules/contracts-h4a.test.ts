// HUB-FR-60 · HUB-FR-61 · HUB-FR-62 · HUB-FR-72 · H4a-R03, R05, R07 · QB2, QB4, QB5 · plan §2 · test-plan H4a §3 R41–R52:
// contract `@ai/contracts/studio` — mã lỗi + status, ràng buộc trường theo CHECK DB (QB2 mặc định), union theo runtime,
// PUT bất biến key/runtime (QB5), Orchestrator input, `Me`.
import { describe, expect, it } from "bun:test";
import {
  AGENT_RUNTIMES,
  AgentCreateSchema,
  AgentEnabledSchema,
  agentUpdateSchemaFor,
  CLI_KINDS,
  CWD_MODES,
  MeSchema,
  OrchestratorInputSchema,
  OrchestratorTenantCreateSchema,
  STUDIO_CLI_TOOLS,
  STUDIO_ERRORS,
} from "@ai/contracts/studio";

const P = "e4a00000-0000-4000-8000-000000000311";
const WF1 = "e4a00000-0000-4000-8000-000000000001";
const WF2 = "e4a00000-0000-4000-8000-000000000002";
const base = (o: Record<string, unknown> = {}) => ({
  key: "qc-agent",
  name: { vi: "Tên", en: "Name" },
  description: "Mô tả đủ dài cho Orchestrator.",
  runtime: "llm",
  profile_id: P,
  runtime_options: {},
  workflow_ids: [],
  ...o,
});
const ok = (b: unknown) => AgentCreateSchema.safeParse(b).success;

describe("STUDIO_ERRORS + hằng [HUB-FR-72 · plan §2.1, §2.2]", () => {
  it("HUB-FR-72 · R41 · STUDIO_ERRORS đúng 12 mã + status [plan §2.1]", () => {
    expect(STUDIO_ERRORS).toEqual({
      FORBIDDEN: 403,
      INVALID_REFERENCE: 400,
      VERSION_CONFLICT: 409,
      KEY_TAKEN: 409,
      BASH_ACK_REQUIRED: 422,
      AGENT_IN_USE_AS_ORCHESTRATOR: 409,
      AGENT_HAS_HISTORY: 409,
      AGENT_HAS_ACCESS: 409,
      AGENT_NOT_ORCHESTRATABLE: 409,
      ORCHESTRATOR_EXISTS: 409,
      ORCHESTRATOR_DEFAULT_PROTECTED: 409,
      TENANT_INACTIVE: 409,
    });
  });
  it("HUB-FR-61 · R42 · AGENT_RUNTIMES, CLI_KINDS, STUDIO_CLI_TOOLS, CWD_MODES [plan §2.2 E11]", () => {
    expect([...AGENT_RUNTIMES].sort()).toEqual([
      "agentic-cli",
      "dify-agent",
      "dify-workflow",
      "llm",
      "python",
    ]);
    expect([...CLI_KINDS]).toEqual(["claude", "codex", "gemini"]);
    expect([...STUDIO_CLI_TOOLS]).toEqual(["Read", "Grep", "Glob", "Write", "Edit", "Bash"]);
    expect([...CWD_MODES]).toEqual(["job"]);
  });
});

describe("AgentCreateSchema [HUB-FR-60 · H4a-R03 · QB2 mặc định]", () => {
  it("HUB-FR-60 · R43 · llm hợp lệ ⇒ parse, mặc định timeout_s 600, token_budget null, enabled true, system_prompt '' [plan §2.3]", () => {
    const r = AgentCreateSchema.parse(base());
    expect(r).toMatchObject({
      timeout_s: 600,
      token_budget: null,
      enabled: true,
      system_prompt: "",
    });
  });
  it("HUB-FR-60 · R44 · key theo CHECK DB `^[a-z][a-z0-9-]{1,47}$`: `_` ✗ (QB2), chữ hoa ✗, 1 ký tự ✗, 48 ký tự ✓, 49 ✗ [QB2]", () => {
    expect(ok(base({ key: "qc_x" }))).toBe(false);
    expect(ok(base({ key: "Qc" }))).toBe(false);
    expect(ok(base({ key: "q" }))).toBe(false);
    expect(ok(base({ key: `q${"a".repeat(47)}` }))).toBe(true);
    expect(ok(base({ key: `q${"a".repeat(48)}` }))).toBe(false);
    expect(ok(base({ key: "1qc" }))).toBe(false);
  });
  it("HUB-FR-60 · R45 · name cần cả vi + en (trim 1–100); description 20–400; timeout 10–3600; token_budget 1–10⁷|null [H4a-R03 · QB2]", () => {
    expect(ok(base({ name: { vi: "Tên" } }))).toBe(false);
    expect(ok(base({ name: { vi: "Tên", en: "   " } }))).toBe(false);
    expect(ok(base({ description: "a".repeat(19) }))).toBe(false);
    expect(ok(base({ description: "a".repeat(20) }))).toBe(true);
    expect(ok(base({ description: "a".repeat(401) }))).toBe(false);
    expect(ok(base({ timeout_s: 9 }))).toBe(false);
    expect(ok(base({ timeout_s: 10 }))).toBe(true);
    expect(ok(base({ timeout_s: 3601 }))).toBe(false);
    expect(ok(base({ token_budget: 0 }))).toBe(false);
    expect(ok(base({ token_budget: 10_000_001 }))).toBe(false);
  });
  it("HUB-FR-60 · R46 · profile_id bắt buộc llm/agentic-cli; dify-* không có profile ⇒ parse, có workflow đúng 1 [H4a-R03, R04 · QB4]", () => {
    expect(ok(base({ profile_id: undefined }))).toBe(false);
    expect(
      ok(
        base({
          runtime: "dify-workflow",
          profile_id: undefined,
          workflow_ids: [WF1],
          runtime_options: undefined,
        }),
      ),
    ).toBe(true);
    expect(
      ok(
        base({
          runtime: "dify-workflow",
          profile_id: undefined,
          workflow_ids: [WF1, WF2],
          runtime_options: undefined,
        }),
      ),
    ).toBe(false);
    expect(
      ok(
        base({
          runtime: "dify-agent",
          profile_id: undefined,
          workflow_ids: [],
          runtime_options: undefined,
        }),
      ),
    ).toBe(false);
  });
  it("HUB-FR-61 · R47 · agentic-cli runtime_options: mặc định cli claude, tools [Read, Grep], mcp false, cwd job; tool lạ ✗; trùng ✗ [H4a-R05]", () => {
    const r = AgentCreateSchema.parse(base({ runtime: "agentic-cli", runtime_options: {} })) as {
      runtime_options: unknown;
    };
    expect(r.runtime_options).toMatchObject({
      cli: "claude",
      allowed_tools: ["Read", "Grep"],
      mcp: false,
      cwd_mode: "job",
    });
    expect(
      ok(base({ runtime: "agentic-cli", runtime_options: { allowed_tools: ["WebFetch"] } })),
    ).toBe(false);
    expect(
      ok(base({ runtime: "agentic-cli", runtime_options: { allowed_tools: ["Read", "Read"] } })),
    ).toBe(false);
    expect(ok(base({ runtime: "agentic-cli", runtime_options: { cli: "cursor" } }))).toBe(false);
    expect(
      ok(
        base({
          runtime: "agentic-cli",
          runtime_options: { allowed_tools: ["Bash"] },
          bash_ack: true,
        }),
      ),
    ).toBe(true);
  });
  it("HUB-FR-60 · R48 · python cần agent_type_key; workflow_ids unique ≤ 20 [plan §2.3]", () => {
    expect(ok(base({ runtime: "python", profile_id: undefined, runtime_options: { a: 1 } }))).toBe(
      false,
    );
    expect(
      ok(
        base({
          runtime: "python",
          profile_id: undefined,
          agent_type_key: "py-report",
          runtime_options: { a: 1 },
        }),
      ),
    ).toBe(true);
    expect(ok(base({ workflow_ids: [WF1, WF1] }))).toBe(false);
  });
});

describe("Update / Enabled / Orchestrator / Me [HUB-FR-62 · HUB-FR-69 · QB2, QB5]", () => {
  it("HUB-FR-60 · R49 · agentUpdateSchemaFor(runtime): có key hoặc runtime ⇒ ✗ (QB5); thiếu version ⇒ ✗ [plan P10]", () => {
    const { key: _k, runtime: _r, ...rest } = base();
    const S = agentUpdateSchemaFor("llm");
    expect(S.safeParse({ ...rest, version: 1 }).success).toBe(true);
    expect(S.safeParse({ ...rest, version: 1, key: "doi" }).success).toBe(false);
    expect(S.safeParse({ ...rest, version: 1, runtime: "llm" }).success).toBe(false);
    expect(S.safeParse(rest).success).toBe(false);
  });
  it("HUB-FR-69 · R50 · AgentEnabledSchema {enabled, version ≥ 1} strict [plan §2.3]", () => {
    expect(AgentEnabledSchema.safeParse({ enabled: false, version: 1 }).success).toBe(true);
    expect(AgentEnabledSchema.safeParse({ enabled: false, version: 0 }).success).toBe(false);
    expect(AgentEnabledSchema.safeParse({ enabled: false }).success).toBe(false);
  });
  it("HUB-FR-62 · R51 · OrchestratorInput: max_steps 1–20, token_budget 1000–10⁷, history_n 1–50 (QB2), on_no_match answer|ask; tenant create cần tenant_id [H4a-R07 · QB2]", () => {
    const o = {
      agent_id: P,
      max_steps: 5,
      token_budget: 200_000,
      history_n: 10,
      on_no_match: "answer",
    };
    const v = (x: Record<string, unknown>) =>
      OrchestratorInputSchema.safeParse({ ...o, ...x }).success;
    expect(v({})).toBe(true);
    expect([v({ max_steps: 0 }), v({ max_steps: 21 }), v({ max_steps: 20 })]).toEqual([
      false,
      false,
      true,
    ]);
    expect([v({ token_budget: 999 }), v({ token_budget: 1000 })]).toEqual([false, true]);
    expect([
      v({ history_n: 0 }),
      v({ history_n: 1 }),
      v({ history_n: 50 }),
      v({ history_n: 51 }),
    ]).toEqual([false, true, true, false]);
    expect(v({ on_no_match: "skip" })).toBe(false);
    expect(OrchestratorTenantCreateSchema.safeParse(o).success).toBe(false);
    expect(OrchestratorTenantCreateSchema.safeParse({ ...o, tenant_id: P }).success).toBe(true);
  });
  it("HUB-FR-72 · R52 · MeSchema role chỉ platform_admin [H4a-R02 · E9]", () => {
    const me = {
      user_id: P,
      tenant_id: P,
      tenant_key: "platform",
      username: "padmin",
      display_name: "P Admin",
      role: "platform_admin",
      hub_config_version: 3,
    };
    expect(MeSchema.safeParse(me).success).toBe(true);
    expect(MeSchema.safeParse({ ...me, role: "tenant_admin" }).success).toBe(false);
  });
});
