// HUB-H2a-AC-11 · H2a-R16, R25 · HUB-FR-10 · HUB-FR-89 · HUB-FR-95 · contract H2a: chat chỉ thêm, `hub` union mới,
// `hub-internal` (test-plan H2a §4 R70–R74, cases §1.8; plan §2).
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CHAT_API_ERRORS,
  CHAT_COMMAND_ERRORS,
  CHAT_EVENT_NAMES,
  CHAT_RUN_ERROR_CODES,
  CmdMissingArgDetailsSchema,
  CmdNotFoundDetailsSchema,
  CommandMenuItemSchema,
  CommandMenuResponseSchema,
  SendMessageRequestSchema,
} from "@ai/contracts/chat";
import {
  HUB_JOB_ERROR_CODES,
  JOB_FAIL_REASONS,
  JobPayloadSchema,
  McpConfigSchema,
  WorkflowAsyncJobSchema,
} from "@ai/contracts/hub";
import {
  DifyCredentialResponseSchema,
  MCP_PROTOCOL_VERSIONS,
  TestRunRequestSchema,
  TestRunResponseSchema,
  ToolConfirmationRequiredSchema,
} from "@ai/contracts/hub-internal";
import { uid } from "./_catalog";

const FIXTURES = resolve(import.meta.dir, "../../../../packages/contracts/fixtures/hub");
const readJson = (p: string): unknown => JSON.parse(readFileSync(p, "utf8"));
const fixtures = (kind: "valid" | "invalid", prefix: string) =>
  readdirSync(resolve(FIXTURES, kind))
    .filter((f) => f.startsWith(`${prefix}.`) && f.endsWith(".json"))
    .map((f) => ({ f, data: readJson(resolve(FIXTURES, kind, f)) }));

const menuItem = { name: "dich", aliases: [], description: { vi: "Dịch", en: null }, args: [] };
const menuArg = {
  name: "lang",
  description: { vi: "Ngôn ngữ", en: null },
  required: true,
  has_fallback: false,
  rest: false,
};

describe("HUB-H2a-AC-11 · chat chỉ thêm [R70–R72]", () => {
  it("H2a-R16 · SendMessageRequest + context; khoá lạ / page_url ftp / quá giới hạn → lỗi [R70]", () => {
    const ok = { content: "/dich en", context: { selection: "xin chào" } };
    expect(SendMessageRequestSchema.parse(ok)).toEqual(ok);
    const full = { selection: "a", page_url: "https://a.vn", page_text: "b" };
    expect(SendMessageRequestSchema.safeParse({ content: "x", context: full }).success).toBe(true);
    const bad = [
      { selection: "a", extra: 1 },
      { page_url: "ftp://a.vn" },
      { selection: "a".repeat(16_001) },
      { page_text: "a".repeat(50_001) },
    ];
    for (const context of bad)
      expect(SendMessageRequestSchema.safeParse({ content: "x", context }).success).toBe(false);
    expect(SendMessageRequestSchema.parse({ content: "x" })).toEqual({ content: "x" });
  });

  it("HUB-H2a-AC-11 · CHAT_API_ERRORS 6 mã cũ; CMD_* riêng; CHAT_EVENT_NAMES không đổi; details ≤ 3 / ≤ 50 [R71]", () => {
    expect(Object.keys(CHAT_API_ERRORS).sort()).toEqual(
      [
        "AUTH_EXPIRED",
        "EVENTS_EXPIRED",
        "FLOW_BUSY",
        "INTERNAL_ERROR",
        "NOT_FOUND",
        "VALIDATION_ERROR",
      ].sort(),
    );
    expect(CHAT_COMMAND_ERRORS).toEqual({ CMD_NOT_FOUND: 404, CMD_MISSING_ARG: 422 });
    expect([...CHAT_EVENT_NAMES]).toEqual([
      "run.started",
      "step.started",
      "step.finished",
      "delta",
      "ask",
      "run.finished",
      "run.failed",
    ]);
    expect(CmdNotFoundDetailsSchema.safeParse({ suggestions: ["a", "b", "c"] }).success).toBe(true);
    expect(CmdNotFoundDetailsSchema.safeParse({ suggestions: ["a", "b", "c", "d"] }).success).toBe(
      false,
    );
    const fifty = Array.from({ length: 50 }, (_, i) => `a${i}`);
    expect(CmdMissingArgDetailsSchema.safeParse({ missing: fifty, invalid: [] }).success).toBe(
      true,
    );
    expect(
      CmdMissingArgDetailsSchema.safeParse({ missing: [...fifty, "x"], invalid: [] }).success,
    ).toBe(false);
    expect(CmdMissingArgDetailsSchema.safeParse({ missing: [] }).success).toBe(false);
  });

  it("HUB-FR-10 · CommandMenu giới hạn: aliases ≤ 5, args ≤ 20, items ≤ 500 [R72]", () => {
    const aliases = (n: number) => Array.from({ length: n }, (_, i) => `al${i}`);
    const args = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ ...menuArg, name: `a${i}` }));
    expect(CommandMenuItemSchema.safeParse({ ...menuItem, aliases: aliases(5) }).success).toBe(
      true,
    );
    expect(CommandMenuItemSchema.safeParse({ ...menuItem, aliases: aliases(6) }).success).toBe(
      false,
    );
    expect(CommandMenuItemSchema.safeParse({ ...menuItem, args: args(20) }).success).toBe(true);
    expect(CommandMenuItemSchema.safeParse({ ...menuItem, args: args(21) }).success).toBe(false);
    const items = (n: number) => Array.from({ length: n }, () => menuItem);
    expect(CommandMenuResponseSchema.safeParse({ items: items(500) }).success).toBe(true);
    expect(CommandMenuResponseSchema.safeParse({ items: items(501) }).success).toBe(false);
  });
});

describe("HUB-FR-89 · contract hub + hub-internal [R73, R74]", () => {
  it("HUB-FR-89 · JobPayload union; WorkflowAsyncJob/McpConfig không secret/token; mã lỗi [R73]", () => {
    const valid = fixtures("valid", "JobPayload");
    expect(valid.map((x) => x.f)).toEqual(
      expect.arrayContaining([
        "JobPayload.agent.json",
        "JobPayload.workflow-async.json",
        "JobPayload.workflow-chat.json",
        "JobPayload.agent-mcp.json",
      ]),
    );
    for (const x of valid)
      expect({ f: x.f, ok: JobPayloadSchema.safeParse(x.data).success }).toEqual({
        f: x.f,
        ok: true,
      });
    const invalid = fixtures("invalid", "JobPayload");
    expect(invalid.length).toBeGreaterThanOrEqual(2);
    for (const x of invalid)
      expect({ f: x.f, ok: JobPayloadSchema.safeParse(x.data).success }).toEqual({
        f: x.f,
        ok: false,
      });
    const wa = readJson(resolve(FIXTURES, "valid", "JobPayload.workflow-async.json")) as Record<
      string,
      unknown
    >;
    expect(WorkflowAsyncJobSchema.safeParse(wa).success).toBe(true);
    for (const extra of [{ api_key: "k" }, { base_url: "http://d/v1" }, { job_token: "t" }])
      expect(WorkflowAsyncJobSchema.safeParse({ ...wa, ...extra }).success).toBe(false);
    const mcp = { url: "http://localhost:4000/mcp", tools: ["check-invoice"] };
    expect(McpConfigSchema.safeParse(mcp).success).toBe(true);
    expect(McpConfigSchema.safeParse({ ...mcp, token: "t" }).success).toBe(false);
    expect(McpConfigSchema.safeParse({ ...mcp, tools: [] }).success).toBe(false);
    const t21 = Array.from({ length: 21 }, (_, i) => `tool-${i}`);
    expect(McpConfigSchema.safeParse({ ...mcp, tools: t21 }).success).toBe(false);
    expect(HUB_JOB_ERROR_CODES).toContain("NOT_CONFIGURED");
    for (const c of HUB_JOB_ERROR_CODES) expect(CHAT_RUN_ERROR_CODES).toContain(c);
    expect(JOB_FAIL_REASONS).toEqual(expect.arrayContaining(["credential", "upstream"]));
  });

  it("HUB-FR-51 · HUB-FR-95 · TestRun, DifyCredential, MCP_PROTOCOL_VERSIONS, ToolConfirmationRequired [R74]", () => {
    const req = {
      command: { workflow_id: uid(101), output: { field: "text", render: "markdown" } },
      text: "en xin",
      actor_user_id: uid(1),
    };
    const parsed = TestRunRequestSchema.parse(req);
    expect(parsed.command.args).toEqual([]);
    expect(parsed.command.timeout_s).toBe(30);
    const tail = { steps: [], usage: { input_tokens: 0, output_tokens: 0, cost_usd: 0 }, ms: 1 };
    expect(TestRunResponseSchema.safeParse({ ok: true, output: "x", ...tail }).success).toBe(true);
    const error = { code: "UPSTREAM_ERROR", message: "m", detail: null };
    expect(TestRunResponseSchema.safeParse({ ok: false, error, ...tail }).success).toBe(true);
    expect(TestRunResponseSchema.safeParse({ ok: true, error, ...tail }).success).toBe(false);
    const cred = { base_url: "http://d/v1", api_key: "mk-ok", app_type: "workflow" };
    expect(DifyCredentialResponseSchema.safeParse(cred).success).toBe(true);
    expect(DifyCredentialResponseSchema.safeParse({ ...cred, extra: 1 }).success).toBe(false);
    expect(MCP_PROTOCOL_VERSIONS[0]).toBe("2026-07-28");
    const c = { code: "CONFIRMATION_REQUIRED", question: "Tiếp tục?", choices: ["Đồng ý", "Huỷ"] };
    expect(ToolConfirmationRequiredSchema.safeParse(c).success).toBe(true);
    for (const choices of [["a"], ["a", "b", "c"]])
      expect(ToolConfirmationRequiredSchema.safeParse({ ...c, choices }).success).toBe(false);
  });
});
