// HUB-FR-131 · HUB-FR-132 · HUB-FR-134 · spec §3.1–3.4 (contract `hub-admin/kh.ts`, `StageView.knowledge`, `Agent.knowledge_enabled`)
// · test-plan K1 §4 R70–R80: regex ns/project/keyspace, mặc định project, mã kiểm (17 lỗi + 4 cảnh báo), 11 mã hạ cấp,
// StageKnowledge, hằng tool/budget/Tóm tắt, bảng mã lỗi HTTP. Export vắng ⇒ đỏ ở `schema()` / expect.
import { describe, expect, it } from "bun:test";
import { loadChat, loadHubAdmin, loadStudio, ok, schema } from "./_rules";

const c = await loadHubAdmin();
const list = (v: unknown): string[] =>
  Array.isArray(v) ? (v as string[]) : ((v as { options?: string[] })?.options ?? []);

const CHECK_ERRORS = [
  "kh_url_not_allowed",
  "kh_unreachable",
  "kh_timeout",
  "kh_version_too_old",
  "kh_auth_disabled",
  "kh_credentials_invalid",
  "kh_credentials_rejected",
  "kh_token_failed",
  "kh_api_v1_missing",
  "kh_capability_missing",
  "kh_identity_unexpected",
  "kh_ns_mismatch",
  "kh_ns_not_active",
  "kh_manifest_missing",
  "kh_people_lanes_on_shared",
  "kh_keyspace_missing",
  "kh_project_not_attached",
];
const CHECK_WARNINGS = [
  "kh_auth_disabled_dev",
  "kh_ns_suspended",
  "kh_projects_unverified",
  "kh_embedder_multilingual",
];
const WARNINGS = [
  "unreachable",
  "timeout",
  "ns_not_active",
  "ns_suspended",
  "embedder_unavailable",
  "unauthorized",
  "forbidden",
  "quota",
  "invalid",
  "server_error",
  "disabled",
];

describe("R70–R73 · kiểu chung [spec §3.1]", () => {
  it("HUB-BR-35 · R70 · KhNsSchema: ^[a-z][a-z0-9_]{2,31}$, không bắt đầu kh, không tên dành riêng", () => {
    const s = schema(c, "KhNsSchema");
    for (const v of ["acme_ns", "abc", `a${"b".repeat(31)}`])
      expect({ v, ok: ok(s, v) }).toEqual({ v, ok: true });
    for (const v of [
      "ab",
      "Acme",
      "1abc",
      "a-b",
      "khacme",
      "kh_x",
      `a${"b".repeat(32)}`,
      "admin",
      "me",
      "capabilities",
      "token",
      "redaction",
      "openapi",
      "health",
      "version",
    ])
      expect({ v, ok: ok(s, v) }).toEqual({ v, ok: false });
  });
  it("HUB-FR-132 · R71 · KhProjectIdSchema / KhKeyspaceSchema theo regex; KhProjectSchema mặc định label '' + read_only false, strict", () => {
    const p = schema(c, "KhProjectIdSchema");
    for (const v of ["proj-a", "P1.x:y_z", "a"])
      expect({ v, ok: ok(p, v) }).toEqual({ v, ok: true });
    for (const v of ["", "-a", "a b", "a".repeat(129)])
      expect({ v, ok: ok(p, v) }).toEqual({ v, ok: false });
    const k = schema(c, "KhKeyspaceSchema");
    expect([ok(k, "step"), ok(k, "a.b-c_d"), ok(k, "Step"), ok(k, "1a")]).toEqual([
      true,
      true,
      false,
      false,
    ]);
    const pr = schema(c, "KhProjectSchema");
    expect(pr.parse({ project_id: "proj-a" })).toEqual({
      project_id: "proj-a",
      label: "",
      read_only: false,
    });
    expect(ok(pr, { project_id: "proj-a", extra: 1 })).toBe(false);
    expect(ok(pr, { project_id: "proj-a", label: "x".repeat(81) })).toBe(false);
  });
  it("HUB-FR-131 · K1-AC01 · R72 · KH_CHECK_CODES = 17 lỗi + 4 cảnh báo; KhCheckItem/KhCheckResult strict, items ≤ 30, dims ≤ 8", () => {
    expect([...list(c.KH_CHECK_CODES)].sort()).toEqual([...CHECK_ERRORS, ...CHECK_WARNINGS].sort());
    const r = schema(c, "KhCheckResultSchema");
    const good = {
      status: "error",
      checked_at: "2026-10-13T08:00:00.000Z",
      kh_version: null,
      keyspace_dims: [],
      items: [
        { code: "kh_people_lanes_on_shared", level: "error", params: { project_id: "proj-s" } },
      ],
    };
    expect(ok(r, good)).toBe(true);
    expect(ok(r, { ...good, items: [{ code: "kh_lạ", level: "error" }] })).toBe(false);
    expect(ok(r, { ...good, keyspace_dims: Array.from({ length: 9 }, (_, i) => `d${i}`) })).toBe(
      false,
    );
    expect(ok(r, { ...good, items: Array.from({ length: 31 }, () => good.items[0]) })).toBe(false);
    expect(ok(r, { ...good, extra: 1 })).toBe(false);
  });
  it("HUB-FR-134 · R73 · KH_WARNING_CODES = 11 mã hạ cấp (plan §3.3)", () => {
    expect([...list(c.KH_WARNING_CODES)].sort()).toEqual([...WARNINGS].sort());
  });
});

describe("R74–R77 · schema API [spec §3.2–3.3]", () => {
  it("HUB-FR-131 · R74 · KhTenantSchema / KhSettingsSchema / KhStatusSchema có; status ∈ unchecked|ok|error", () => {
    const st = schema(c, "KhStatusSchema");
    expect([ok(st, "unchecked"), ok(st, "ok"), ok(st, "error"), ok(st, "checked")]).toEqual([
      true,
      true,
      true,
      false,
    ]);
    schema(c, "KhTenantSchema");
    const s = schema(c, "KhSettingsSchema");
    expect(
      ok(s, {
        base_url: null,
        allowed_origins: ["https://kh.example.com"],
        timeout_ms: 5000,
        version: 1,
        updated_at: "2026-10-13T08:00:00.000Z",
      }),
    ).toBe(true);
  });
  it("HUB-FR-132 · K1-AC04 · R75 · StageKnowledgeSchema: queries 0..5, query_limit 5, warning mã hạ cấp|null, summary 5 trạng thái", async () => {
    const ch = await loadChat();
    const k = schema(ch, "StageKnowledgeSchema");
    const v = {
      project_id: "proj-a",
      read_only: false,
      queries: 5,
      query_limit: 5,
      warning: null,
      summary: "written",
    };
    expect(ok(k, v)).toBe(true);
    for (const s of ["none", "pending", "written", "failed", "skipped"])
      expect(ok(k, { ...v, summary: s })).toBe(true);
    expect([
      ok(k, { ...v, queries: 6 }),
      ok(k, { ...v, query_limit: 4 }),
      ok(k, { ...v, warning: "lạ" }),
      ok(k, { ...v, summary: "done" }),
    ]).toEqual([false, false, false, false]);
    expect(ok(k, { ...v, warning: "ns_suspended" })).toBe(true);
    const sv = schema(ch, "StageViewSchema");
    expect(typeof sv.shape?.knowledge?.safeParse).toBe("function");
    expect(sv.shape.knowledge.safeParse(undefined).success).toBe(true);
  });
  it("HUB-FR-132 · D17 · R76 · AgentSchema + AgentListItemSchema có knowledge_enabled: boolean", async () => {
    const s = await loadStudio();
    for (const n of ["AgentSchema", "AgentListItemSchema"]) {
      const f = schema(s, n).shape?.knowledge_enabled;
      expect({ n, has: typeof f?.safeParse }).toEqual({ n, has: "function" });
      expect([f.safeParse(true).success, f.safeParse("x").success]).toEqual([true, false]);
    }
  });
  it("HUB-FR-131 · HUB-FR-132 · R77 · HUB_KH_ERRORS: mã → HTTP theo spec §3.2–3.3", () => {
    expect(c.HUB_KH_ERRORS).toMatchObject({
      KH_URL_NOT_ALLOWED: 422,
      KH_TENANT_EXISTS: 409,
      KH_NS_TAKEN: 409,
      KH_SECRET_INVALID: 422,
      KH_PROJECT_IN_USE: 409,
      KH_NOT_CONFIGURED: 409,
      KH_AGENT_RUNTIME: 422,
      KH_PROJECT_NOT_FOUND: 404,
    });
  });
});

describe("R78 · hằng [plan §1]", () => {
  it("HUB-FR-132 · HUB-FR-133 · Q1 · R78 · KH_TOOL_KEY 'kh-query', KH_QUERY_LIMIT 5, KH_BUDGET_CHARS 4000, KH_SUMMARY_SECTION 'Tóm tắt', KH_SUMMARY_WORDS 200", () => {
    expect({
      tool: c.KH_TOOL_KEY,
      limit: c.KH_QUERY_LIMIT,
      budget: c.KH_BUDGET_CHARS,
      section: c.KH_SUMMARY_SECTION,
      words: c.KH_SUMMARY_WORDS,
    }).toEqual({ tool: "kh-query", limit: 5, budget: 4000, section: "Tóm tắt", words: 200 });
    expect(/^[a-z0-9-]{2,32}$/.test(String(c.KH_TOOL_KEY))).toBe(true);
  });
});
