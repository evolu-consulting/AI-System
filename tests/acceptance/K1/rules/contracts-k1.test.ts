// HUB-FR-131 · HUB-FR-132 · HUB-FR-133 · HUB-FR-134 · CR-073 · spec §3.1–3.2 (contract `hub-admin/kh.ts`, `StageView.knowledge`,
// `Agent.knowledge_connection_ids`) + plan §1 (hằng) · test-plan K1 §4 R80–R89. Export vắng ⇒ đỏ ở `schema()` / expect.
import { describe, expect, it } from "bun:test";
import { flat, loadChat, loadHubAdmin, loadStudio, ok, schema } from "./_rules";

const c = await loadHubAdmin();
const u = (n: number) => `c1a10000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const AT = "2026-10-13T08:00:00.000Z";
const CHECK_ERRORS = [
  "kh_url_not_allowed",
  "kh_unreachable",
  "kh_timeout",
  "kh_auth_disabled",
  "kh_key_invalid",
  "kh_key_rejected",
  "kh_version_too_old",
];
const CHECK_WARNINGS = [
  "kh_auth_disabled_dev",
  "kh_embedder_english",
  "kh_projects_empty",
  "kh_projects_many",
  "kh_summary_project_missing",
];
const WARNINGS = [
  "unreachable",
  "timeout",
  "unauthorized",
  "forbidden",
  "not_found",
  "invalid",
  "rate_limited",
  "server_error",
  "disabled",
];
const result = (o: Record<string, unknown> = {}) => ({
  status: "ok",
  checked_at: AT,
  kh_version: "v6.4",
  embedder: "BAAI/bge-m3",
  projects: ["proj-a"],
  items: [],
  ...o,
});
const connection = (o: Record<string, unknown> = {}) => ({
  id: u(41),
  name: "kh-main",
  base_url: "https://kh.example.com",
  secret: { id: u(1), name: "kh-key" },
  summary_project: "proj-a",
  status: "ok",
  check: result(),
  agents_count: 2,
  version: 1,
  updated_at: AT,
  updated_by: "padmin",
  ...o,
});

describe("R80–R83 · kiểu chung [spec §3.1]", () => {
  it("HUB-FR-132 · Q25 · R80 · KhProjectIdSchema ^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$ (không '/'); KhConnectionNameSchema trim 1..80 không '/'", () => {
    const p = schema(c, "KhProjectIdSchema");
    for (const v of ["proj-a", "A", "a.b:c_d-1", `a${"b".repeat(127)}`])
      expect({ v, ok: ok(p, v) }).toEqual({ v, ok: true });
    for (const v of ["", "-a", "a/b", "a b", `a${"b".repeat(128)}`])
      expect({ v, ok: ok(p, v) }).toEqual({ v, ok: false });
    const n = schema(c, "KhConnectionNameSchema");
    expect(n.parse("  kh-main  ")).toBe("kh-main");
    for (const v of ["", "   ", "a/b", "x".repeat(81)])
      expect({ v, ok: ok(n, v) }).toEqual({ v, ok: false });
    expect(ok(n, "x".repeat(80))).toBe(true);
  });
  it("HUB-FR-131 · K1-AC01 · R81 · KH_CHECK_CODES đủ 7 lỗi + 5 cảnh báo; KhCheckItemSchema nhận mọi mã, từ chối mã lạ/level lạ", () => {
    const all = flat(c.KH_CHECK_CODES);
    for (const code of [...CHECK_ERRORS, ...CHECK_WARNINGS])
      expect({ code, has: all.includes(code) }).toEqual({ code, has: true });
    const s = schema(c, "KhCheckItemSchema");
    expect(ok(s, { code: "kh_timeout", level: "error" })).toBe(true);
    expect(ok(s, { code: "kh_projects_many", level: "warning", params: { count: 61 } })).toBe(true);
    expect(ok(s, { code: "kh_people_lanes_on", level: "warning" })).toBe(false);
    expect(ok(s, { code: "kh_timeout", level: "info" })).toBe(false);
  });
  it("HUB-FR-131 · R82 · KhCheckResultSchema: error ⇔ có mục lỗi; projects ≤ 50; items ≤ 20; strict", () => {
    const s = schema(c, "KhCheckResultSchema");
    expect(ok(s, result())).toBe(true);
    expect(ok(s, result({ kh_version: null, embedder: null, projects: [] }))).toBe(true);
    expect(ok(s, result({ status: "error" }))).toBe(false);
    expect(ok(s, result({ items: [{ code: "kh_timeout", level: "error" }] }))).toBe(false);
    expect(
      ok(s, result({ status: "error", items: [{ code: "kh_timeout", level: "error" }] })),
    ).toBe(true);
    expect(ok(s, result({ items: [{ code: "kh_projects_empty", level: "warning" }] }))).toBe(true);
    expect(ok(s, result({ projects: Array.from({ length: 51 }, (_, i) => `p${i}`) }))).toBe(false);
    const w = { code: "kh_projects_empty", level: "warning" };
    expect(ok(s, result({ items: Array.from({ length: 21 }, () => w) }))).toBe(false);
    expect(ok(s, result({ extra: 1 }))).toBe(false);
  });
  it("HUB-FR-134 · R83 · KH_WARNING_CODES đúng 9 mã spec §3.1", () => {
    expect(
      [...new Set(flat(c.KH_WARNING_CODES))].filter((x) => WARNINGS.includes(x)).sort(),
    ).toEqual([...WARNINGS].sort());
  });
});

describe("R84–R86 · kết nối + ghi [spec §3.1–3.2]", () => {
  it("HUB-FR-131 · R84 · KhConnectionSchema strict (secret {id,name}, status 3 giá trị, check nullable)", () => {
    const s = schema(c, "KhConnectionSchema");
    expect(ok(s, connection())).toBe(true);
    expect(ok(s, connection({ status: "unchecked", check: null, summary_project: null }))).toBe(
      true,
    );
    expect(ok(s, connection({ status: "pending" }))).toBe(false);
    expect(ok(s, connection({ secret_value: "x" }))).toBe(false);
    expect(ok(s, connection({ ns: "acme_ns" }))).toBe(false);
  });
  it("HUB-FR-131 · R85 · KhConnectionWriteSchema: summary_project mặc định null, base_url ≤ 512, secret_id uuid, name không '/'", () => {
    const s = schema(c, "KhConnectionWriteSchema");
    const base = { name: "kh-main", base_url: "https://kh.example.com", secret_id: u(1) };
    expect(s.parse(base)).toMatchObject({ ...base, summary_project: null });
    expect(ok(s, { ...base, summary_project: "proj-a" })).toBe(true);
    expect(ok(s, { ...base, summary_project: "a/b" })).toBe(false);
    expect(ok(s, { ...base, secret_id: "x" })).toBe(false);
    expect(ok(s, { ...base, base_url: `https://kh.example.com/${"a".repeat(500)}` })).toBe(false);
    expect(ok(s, { ...base, name: "a/b" })).toBe(false);
    expect(ok(s, { ...base, tenant_id: u(2) })).toBe(false);
  });
  it("HUB-FR-131 · HUB-FR-132 · R86 · HUB_KH_ERRORS: mã spec §3.2 với status (409 EXISTS/IN_USE · 422 URL/SECRET/RUNTIME/NOT_FOUND)", () => {
    const e = c.HUB_KH_ERRORS as Record<string, number>;
    expect(e).toMatchObject({
      KH_CONNECTION_EXISTS: 409,
      KH_CONNECTION_IN_USE: 409,
      KH_URL_NOT_ALLOWED: 422,
      KH_SECRET_INVALID: 422,
      KH_AGENT_RUNTIME: 422,
      KH_CONNECTION_NOT_FOUND: 422,
    });
  });
});

describe("R87–R89 · StageView.knowledge, Agent, hằng [spec §3.1 · plan §1]", () => {
  it("HUB-FR-134 · HUB-FR-133 · R87 · StageKnowledgeSchema: write_to {connection, project} | null, queries 0..5, query_limit 5, warning ∈ mã | null, summary 5 giá trị", async () => {
    const s = schema(c, "StageKnowledgeSchema");
    const k = {
      write_to: { connection: "kh-main", project: "proj-a" },
      queries: 2,
      query_limit: 5,
      warning: "unreachable",
      summary: "pending",
    };
    expect(ok(s, k)).toBe(true);
    expect(ok(s, { ...k, write_to: null, warning: null, summary: "none" })).toBe(true);
    for (const sm of ["written", "failed", "skipped"])
      expect(ok(s, { ...k, summary: sm })).toBe(true);
    expect(ok(s, { ...k, queries: 6 })).toBe(false);
    expect(ok(s, { ...k, query_limit: 6 })).toBe(false);
    expect(ok(s, { ...k, warning: "ns_suspended" })).toBe(false);
    expect(ok(s, { ...k, summary: "done" })).toBe(false);
    const sv = schema(await loadChat(), "StageViewSchema");
    expect(Object.keys(sv.shape ?? {})).toContain("knowledge");
    expect(sv.shape.knowledge.safeParse(undefined).success).toBe(true);
  });
  it("HUB-FR-132 · R88 · AgentSchema.knowledge_connection_ids (uuid[]), AgentListItemSchema.knowledge_count", async () => {
    const st = await loadStudio();
    const a = schema(st, "AgentSchema");
    const li = schema(st, "AgentListItemSchema");
    expect(Object.keys(a.shape ?? {})).toContain("knowledge_connection_ids");
    expect(Object.keys(li.shape ?? {})).toContain("knowledge_count");
    expect(a.shape.knowledge_connection_ids.safeParse([u(41), u(42)]).success).toBe(true);
    expect(a.shape.knowledge_connection_ids.safeParse(["x"]).success).toBe(false);
  });
  it("HUB-FR-132 · HUB-BR-31 · R89 · hằng plan §1: tool kh-query, 5 lần, 4000 ký tự, k 8, max_chars 1500, ≤ 5 KH/agent, ≤ 50 project, cache 300 s, ≥ v6.4, 'Tóm tắt' 200 từ, header X-KH-Key", () => {
    expect({
      KH_TOOL_KEY: c.KH_TOOL_KEY,
      KH_QUERY_LIMIT: c.KH_QUERY_LIMIT,
      KH_BUDGET_CHARS: c.KH_BUDGET_CHARS,
      KH_QUERY_K: c.KH_QUERY_K,
      KH_QUERY_MAX_CHARS: c.KH_QUERY_MAX_CHARS,
      KH_AGENT_CONNECTIONS_MAX: c.KH_AGENT_CONNECTIONS_MAX,
      KH_PROJECTS_MAX: c.KH_PROJECTS_MAX,
      KH_PROJECTS_CACHE_MS: c.KH_PROJECTS_CACHE_MS,
      KH_MIN_VERSION: c.KH_MIN_VERSION,
      KH_SUMMARY_SECTION: c.KH_SUMMARY_SECTION,
      KH_SUMMARY_WORDS: c.KH_SUMMARY_WORDS,
      KH_KEY_HEADER: c.KH_KEY_HEADER,
    }).toEqual({
      KH_TOOL_KEY: "kh-query",
      KH_QUERY_LIMIT: 5,
      KH_BUDGET_CHARS: 4000,
      KH_QUERY_K: 8,
      KH_QUERY_MAX_CHARS: 1500,
      KH_AGENT_CONNECTIONS_MAX: 5,
      KH_PROJECTS_MAX: 50,
      KH_PROJECTS_CACHE_MS: 300_000,
      KH_MIN_VERSION: [6, 4],
      KH_SUMMARY_SECTION: "Tóm tắt",
      KH_SUMMARY_WORDS: 200,
      KH_KEY_HEADER: "X-KH-Key",
    });
  });
});
