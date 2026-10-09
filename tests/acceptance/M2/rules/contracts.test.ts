// ADM-FR-10, ADM-FR-11, ADM-FR-20, ADM-FR-21, ADM-FR-30, ADM-FR-50, ADM-BR-01, ADM-BR-02, ADM-BR-04 ·
// hằng, bảng mã lỗi và schema contract M2 (spec §3). Chỉ cần @ai/contracts (test-plan R1).
import { describe, expect, it } from "bun:test";
import * as C from "@ai/contracts";
import {
  API_ERRORS,
  ArgsSchema,
  CATALOG_KEY_RE,
  CommandCreateRequestSchema,
  CommandListCountsSchema,
  CommandNameSchema,
  CommandOutputSchema,
  CommandSchema,
  CommandUpdateRequestSchema,
  FeatureCreateRequestSchema,
  FeatureDetailSchema,
  FeatureListCountsSchema,
  FeatureUpdateRequestSchema,
  InputMapEntrySchema,
  InputMapInvalidDetailsSchema,
  InputMapSchema,
  InputMapWarningSchema,
  InputSchemaSchema,
  InvalidReferenceDetailsSchema,
  listResponseSchema,
  pageResponseSchema,
  SchemaBreaksCommandsDetailsSchema,
  SecretCreateRequestSchema,
  SecretListCountsSchema,
  SecretNoteRequestSchema,
  SecretReplaceRequestSchema,
  SecretSchema,
  versionConflictDetailsSchema,
  WorkflowCreateRequestSchema,
  WorkflowInUseDetailsSchema,
  WorkflowListCountsSchema,
  WorkflowListQuerySchema,
  WorkflowSchema,
  WorkflowUpdateRequestSchema,
  WorkflowUsagesSchema,
} from "@ai/contracts";

const ok = (r: { success: boolean }) => r.success;
const U1 = "01900000-0000-7000-8000-000000000201";
const U2 = "01900000-0000-7000-8000-000000000202";
const desc = (n: number) => "a".repeat(n);
const uuids = (n: number) =>
  Array.from(
    { length: n },
    (_, i) => `01900000-0000-7000-8000-${String(300 + i).padStart(12, "0")}`,
  );
const wf = (over: Record<string, unknown> = {}) => ({
  key: "translate",
  name: "Translate",
  description: desc(40),
  app_type: "workflow",
  base_url: "https://dify.example.com/v1",
  secret_id: U1,
  ...over,
});
const cmd = (over: Record<string, unknown> = {}) => ({
  name: "dich",
  description: { vi: "Dịch" },
  workflow_id: U1,
  output: { field: "text", render: "markdown" },
  ...over,
});
const inp = (over: Record<string, unknown> = {}) => ({
  name: "a",
  type: "text",
  required: true,
  description: "Mô tả",
  ...over,
});

describe("ADM-FR-10 · bảng mã lỗi", () => {
  it("ADM-FR-10 · spec §3 · API_ERRORS = 23 mã M1 + 9 mã M2 (CR-055 gỡ COMMAND_NEEDS_FEATURE, FEATURE_HAS_EXCLUSIVE_COMMANDS) + 2 mã M3 giữ nguyên sau M4 (toMatchObject)", () => {
    expect(API_ERRORS).toMatchObject({
      VALIDATION_ERROR: 400,
      TENANT_REQUIRED: 400,
      ROLE_NOT_ALLOWED: 400,
      EMAIL_REQUIRED: 400,
      PASSWORD_UNCHANGED: 400,
      INVALID_CURRENT_PASSWORD: 400,
      INVALID_REFERENCE: 400,
      INPUT_MAP_INVALID: 400,
      UNAUTHORIZED: 401,
      INVALID_CREDENTIALS: 401,
      INVALID_REFRESH_TOKEN: 401,
      REFRESH_SUPERSEDED: 401,
      INVALID_CHANGE_TOKEN: 401,
      FORBIDDEN: 403,
      ACCOUNT_LOCKED: 403,
      SELF_ACTION_FORBIDDEN: 403,
      NOT_FOUND: 404,
      VERSION_CONFLICT: 409,
      KEY_TAKEN: 409,
      USERNAME_TAKEN: 409,
      EMAIL_TAKEN: 409,
      LAST_ADMIN: 409,
      PLATFORM_TENANT_LOCKED: 409,
      SECRET_NAME_TAKEN: 409,
      SECRET_IN_USE: 409,
      WORKFLOW_IN_USE: 409,
      SCHEMA_BREAKS_COMMANDS: 409,
      WORKFLOW_DISABLED: 409,
      COMMAND_NAME_TAKEN: 409,
      CORE_FEATURE_PROTECTED: 409,
      BETA_GROUP_PROTECTED: 409,
      NOT_ENTITLED: 409,
      TEMP_LOCKED: 423,
      INTERNAL_ERROR: 500,
    });
    expect(API_ERRORS).not.toHaveProperty("COMMAND_NEEDS_FEATURE");
    expect(API_ERRORS).not.toHaveProperty("FEATURE_HAS_EXCLUSIVE_COMMANDS");
    // M4 (Q2a, test-plan §5 K5): không đếm — tổng 46 mã (48 − 2 theo CR-055) kiểm ở M4/rules/contracts-cd.test.ts (D-K04).
  });

  it("ADM-FR-10 · spec §3 · hằng/regex/enum M2", () => {
    expect(C.SECRET_NAME_RE.source).toBe("^[A-Z0-9_]{2,64}$");
    expect([C.SECRET_VALUE_MIN, C.SECRET_VALUE_MAX, C.SECRET_NOTE_MAX]).toEqual([8, 2048, 200]);
    expect(CATALOG_KEY_RE.source).toBe("^[a-z0-9-]{2,32}$");
    expect([C.WORKFLOW_DESC_MIN, C.WORKFLOW_DESC_MAX]).toEqual([20, 400]);
    expect(C.INPUT_NAME_RE.source).toBe("^[A-Za-z_][A-Za-z0-9_]{0,63}$");
    expect([C.INPUT_SCHEMA_MAX, C.INPUT_DESC_MAX, C.SELECT_OPTIONS_MAX]).toEqual([50, 400, 50]);
    expect(C.ARG_NAME_RE.source).toBe("^[a-z][a-z0-9_]{0,31}$");
    expect([C.ARGS_MAX, C.ALIASES_MAX, C.COMMAND_DESC_MAX]).toEqual([20, 5, 200]);
    expect([C.CONST_VALUE_MAX, C.ARG_DEFAULT_MAX]).toEqual([4000, 1000]);
    expect([C.TIMEOUT_MIN_S, C.TIMEOUT_MAX_S]).toEqual([1, 600]);
    expect(C.TIMEOUT_DEFAULT_S).toEqual({ sync: 30, async: 120 });
    expect([C.FEATURE_NAME_MAX, C.FEATURE_DESC_MAX]).toEqual([64, 400]);
    expect(C.FEATURE_ICON_RE.source).toBe("^[a-z0-9-]{1,40}$");
    expect([C.FEATURE_ICON_DEFAULT, C.CORE_FEATURE_KEY]).toEqual(["package", "core"]);
    expect([C.BASE_URL_MAX, C.OUTPUT_FIELD_MAX]).toEqual([2048, 128]);
    expect(C.APP_TYPES).toEqual(["workflow", "chat", "agent"]);
    expect(C.INPUT_TYPES).toEqual(["text", "number", "boolean", "select", "file"]);
    expect(C.COMMAND_MODES).toEqual(["sync", "async"]);
    expect(C.OUTPUT_RENDERS).toEqual(["markdown", "text", "json"]);
    expect([...C.MAP_SOURCES].sort() as string[]).toEqual(
      [
        "arg",
        "selection",
        "page_url",
        "page_text",
        "attachment",
        "user_id",
        "tenant_id",
        "const",
      ].sort(),
    );
    expect(C.ARG_FALLBACKS).toEqual(["selection", "page_url", "page_text"]);
    expect(C.FEATURE_STATUSES).toEqual(["on", "off", "beta"]);
    expect(C.ON_OFF).toEqual(["on", "off"]);
  });
});

describe("ADM-FR-50 · schema secret", () => {
  it("ADM-FR-50 · M2-R01 · SecretCreateRequest: tên trim + HOA; giá trị 7/8/2048/2049, không trim; ghi chú '' → null", () => {
    const base = { name: " dify_key ", value: "12345678" };
    const parsed = SecretCreateRequestSchema.safeParse(base);
    expect(parsed.success && parsed.data.name).toBe("DIFY_KEY");
    for (const bad of ["a", "A".repeat(65), "DIFY-KEY", "DIFY KEY", ""]) {
      expect(ok(SecretCreateRequestSchema.safeParse({ name: bad, value: "12345678" }))).toBe(false);
    }
    const v = (value: string) => SecretCreateRequestSchema.safeParse({ name: "AB", value });
    expect(ok(v("1234567"))).toBe(false);
    expect(ok(v("12345678"))).toBe(true);
    expect(ok(v("x".repeat(2048)))).toBe(true);
    expect(ok(v("x".repeat(2049)))).toBe(false);
    const padded = v("  1234567 ");
    expect(padded.success && padded.data.value).toBe("  1234567 ");
    const note = SecretCreateRequestSchema.safeParse({ ...base, note: "" });
    expect(note.success && note.data.note).toBeNull();
    const n = (len: number) =>
      SecretCreateRequestSchema.safeParse({ ...base, note: "n".repeat(len) });
    expect(ok(n(200))).toBe(true);
    expect(ok(n(201))).toBe(false);
    expect(ok(SecretCreateRequestSchema.safeParse({ ...base, extra: 1 }))).toBe(false);
    expect(ok(SecretReplaceRequestSchema.safeParse({ value: "12345678" }))).toBe(true);
    expect(ok(SecretReplaceRequestSchema.safeParse({ value: "12345678", note: "x" }))).toBe(false);
    expect(ok(SecretNoteRequestSchema.safeParse({ note: null }))).toBe(true);
    expect(ok(SecretNoteRequestSchema.safeParse({ note: "x", value: "12345678" }))).toBe(false);
  });

  it("ADM-FR-50 · M2-R03 · AC-A06 · SecretSchema (response) strict: không có value/ciphertext/iv/key_version", () => {
    const base = {
      id: U1,
      name: "DIFY_KEY",
      last4: "a91d",
      note: null,
      used_by: [],
      created_at: "2026-10-01T09:00:00.000Z",
      updated_at: "2026-10-01T09:00:00.000Z",
      updated_by: "admin",
    };
    expect(ok(SecretSchema.safeParse(base))).toBe(true);
    for (const k of ["value", "ciphertext", "iv", "key_version"]) {
      expect(ok(SecretSchema.safeParse({ ...base, [k]: "x" }))).toBe(false);
    }
    expect(ok(SecretSchema.safeParse({ ...base, last4: "abc" }))).toBe(false);
    expect(ok(SecretSchema.safeParse({ ...base, last4: "😀😀😀😀" }))).toBe(true);
    expect(ok(SecretSchema.safeParse({ ...base, updated_by: null }))).toBe(true);
  });
});

describe("ADM-FR-10 · schema workflow", () => {
  it("ADM-FR-10 · M2-AC07 · mô tả 19 fail / 20 ok / 400 ok / 401 fail, đếm sau trim; key trim+lower; mặc định enabled", () => {
    const d = (s: string) => WorkflowCreateRequestSchema.safeParse(wf({ description: s }));
    expect(ok(d(desc(19)))).toBe(false);
    expect(ok(d(desc(20)))).toBe(true);
    expect(ok(d(desc(400)))).toBe(true);
    expect(ok(d(desc(401)))).toBe(false);
    expect(ok(d(`  ${desc(19)}  `))).toBe(false);
    const padded = d(`  ${desc(20)}  `);
    expect(padded.success && padded.data.description).toBe(desc(20));
    const k = WorkflowCreateRequestSchema.safeParse(wf({ key: "  TRANSLATE " }));
    expect(k.success && k.data.key).toBe("translate");
    expect(k.success && k.data.enabled).toBe(true);
    expect(ok(WorkflowCreateRequestSchema.safeParse(wf({ name: "n".repeat(128) })))).toBe(true);
    expect(ok(WorkflowCreateRequestSchema.safeParse(wf({ name: "n".repeat(129) })))).toBe(false);
    expect(ok(WorkflowCreateRequestSchema.safeParse(wf({ app_type: "bot" })))).toBe(false);
    expect(ok(WorkflowCreateRequestSchema.safeParse(wf({ secret_id: "abc" })))).toBe(false);
  });

  it("ADM-FR-10 · M2-R07 · base_url: http(s) hợp lệ; ftp, javascript, userinfo, > 2048 → fail", () => {
    const u = (s: string) => ok(WorkflowCreateRequestSchema.safeParse(wf({ base_url: s })));
    expect(u("https://dify.example.com/v1")).toBe(true);
    expect(u("http://localhost:8080")).toBe(true);
    for (const bad of [
      "ftp://x.com",
      "javascript:alert(1)",
      "https://user:pw@x.com",
      "https://u@x.com",
      `https://x.com/${"a".repeat(2050)}`,
      "dify.example.com",
    ]) {
      expect(u(bad)).toBe(false);
    }
  });

  it("ADM-FR-11 · M2-R08 · WorkflowInput/InputSchema: select cần options, kiểu khác cấm; trùng/rỗng/biên", () => {
    const one = (o: Record<string, unknown>) => InputSchemaSchema.safeParse([inp(o)]);
    expect(ok(one({ type: "select", options: ["a", "b"] }))).toBe(true);
    expect(ok(one({ type: "select" }))).toBe(false);
    expect(ok(one({ type: "select", options: [] }))).toBe(false);
    expect(ok(one({ type: "text", options: ["a"] }))).toBe(false);
    expect(ok(one({ type: "select", options: ["a", "a"] }))).toBe(false);
    const opts51 = Array.from({ length: 51 }, (_, i) => `o${i}`);
    expect(ok(one({ type: "select", options: opts51 }))).toBe(false);
    expect(ok(one({ type: "select", options: ["a", " "] }))).toBe(false);
    expect(ok(one({ description: "" }))).toBe(false);
    expect(ok(one({ description: "   " }))).toBe(false);
    expect(ok(one({ name: "1a" }))).toBe(false);
    expect(ok(one({ name: "a-b" }))).toBe(false);
    expect(ok(one({ name: "_x" }))).toBe(true);
    expect(ok(one({ name: "A1" }))).toBe(true);
    expect(ok(one({ name: "a".repeat(65) }))).toBe(false);
    const dup = InputSchemaSchema.safeParse([inp(), inp({ name: "b" }), inp()]);
    expect(dup.success).toBe(false);
    expect(!dup.success && dup.error.issues[0]?.path).toEqual([2, "name"]);
    const n = (k: number) =>
      InputSchemaSchema.safeParse(Array.from({ length: k }, (_, i) => inp({ name: `p${i}` })));
    expect(ok(n(50))).toBe(true);
    expect(ok(n(51))).toBe(false);
  });

  it("ADM-FR-10 · M2-R25 · WorkflowUpdateRequest cần version, không nhận key; WorkflowListQuery: bool chặt, status on|off", () => {
    expect(ok(WorkflowUpdateRequestSchema.safeParse({ version: 1 }))).toBe(true);
    expect(ok(WorkflowUpdateRequestSchema.safeParse({ name: "x" }))).toBe(false);
    expect(ok(WorkflowUpdateRequestSchema.safeParse({ version: 0 }))).toBe(false);
    expect(ok(WorkflowUpdateRequestSchema.safeParse({ version: 1, key: "abc" }))).toBe(false);
    expect(ok(WorkflowUpdateRequestSchema.safeParse({ version: 1, output_field: null }))).toBe(
      true,
    );
    const q = (o: Record<string, string>) => WorkflowListQuerySchema.safeParse(o);
    const att = q({ attached: "false" });
    expect(att.success && att.data.attached).toBe(false);
    expect(ok(q({ attached: "1" }))).toBe(false);
    expect(ok(q({ status: "unattached" }))).toBe(false);
    expect(ok(q({ status: "off" }))).toBe(true);
    const s = q({ secret: " dify_key " });
    expect(s.success && s.data.secret).toBe("DIFY_KEY");
    expect(ok(q({ limit: "0" }))).toBe(false);
    expect(ok(q({ limit: "201" }))).toBe(false);
    expect(ok(q({ offset: "-1" }))).toBe(false);
    expect(ok(q({ unknown: "x" }))).toBe(false);
  });

  it("ADM-FR-15 · M2-R10 · WorkflowUsages: có command_count/agent_count/agents_available; agents strict; vắng bảng ⇒ rỗng", () => {
    const base = {
      commands: [],
      agents: [{ id: U1 }],
      command_count: 0,
      agent_count: 1,
      agents_available: true,
    };
    expect(ok(WorkflowUsagesSchema.safeParse(base))).toBe(true);
    expect(ok(WorkflowUsagesSchema.safeParse({ ...base, agents: [{ id: U1, name: "x" }] }))).toBe(
      false,
    );
    expect(ok(WorkflowUsagesSchema.safeParse({ ...base, agents_available: false }))).toBe(false);
    const none = { commands: [], agents: [], command_count: 0, agent_count: 0 };
    expect(ok(WorkflowUsagesSchema.safeParse({ ...none, agents_available: false }))).toBe(true);
  });
});

describe("ADM-FR-20 · schema command", () => {
  it("ADM-BR-01 · M2-R13 · CommandName/aliases: chuẩn hoá, regex, ≤ 5, không trùng nhau/tên", () => {
    const n = CommandNameSchema.safeParse("  DICH ");
    expect(n.success && n.data).toBe("dich");
    for (const bad of ["d", "a_b", "có-dấu", "x".repeat(33)]) {
      expect(ok(CommandNameSchema.safeParse(bad))).toBe(false);
    }
    const a = (aliases: string[]) => CommandCreateRequestSchema.safeParse(cmd({ aliases }));
    expect(ok(a(["a1", "a2", "a3", "a4", "a5"]))).toBe(true);
    expect(ok(a(["a1", "a2", "a3", "a4", "a5", "a6"]))).toBe(false);
    expect(ok(a(["tr", "tr"]))).toBe(false);
    expect(ok(a(["dich"]))).toBe(false);
    expect(ok(a(["TR"]))).toBe(true);
  });

  it("ADM-FR-20 · M2-R15 · CommandArg/Args: regex, trùng, rest cuối, default/fallback/số lượng", () => {
    const arg = (o: Record<string, unknown> = {}) => ({
      name: "lang",
      description: { vi: "Ngôn ngữ" },
      ...o,
    });
    const parse = (a: unknown[]) => ArgsSchema.safeParse(a);
    expect(ok(parse([arg()]))).toBe(true);
    expect(ok(parse([arg({ name: "Lang" })]))).toBe(false);
    expect(ok(parse([arg({ name: "1a" })]))).toBe(false);
    expect(ok(parse([arg(), arg()]))).toBe(false);
    expect(ok(parse([arg({ rest: true }), arg({ name: "b" })]))).toBe(false);
    expect(ok(parse([arg({ name: "a", rest: true }), arg({ name: "b", rest: true })]))).toBe(false);
    expect(ok(parse([arg({ name: "a" }), arg({ name: "b", rest: true })]))).toBe(true);
    expect(ok(parse([arg({ default: "x".repeat(1001) })]))).toBe(false);
    expect(ok(parse([arg({ fallback: "clipboard" })]))).toBe(false);
    expect(ok(parse([arg({ fallback: "page_text" })]))).toBe(true);
    const many = (k: number) => Array.from({ length: k }, (_, i) => arg({ name: `a${i}` }));
    expect(ok(parse(many(21)))).toBe(false);
    expect(ok(parse(many(20)))).toBe(true);
  });

  it("ADM-FR-21 · M2-R16 · InputMapEntry: arg cần value đúng regex, const ≤ 4000, nguồn khác cấm value, nguồn lạ fail", () => {
    const e = (o: unknown) => InputMapEntrySchema.safeParse(o);
    expect(ok(e({ source: "arg", value: "text" }))).toBe(true);
    expect(ok(e({ source: "arg" }))).toBe(false);
    expect(ok(e({ source: "arg", value: "Text" }))).toBe(false);
    expect(ok(e({ source: "const", value: "x".repeat(4000) }))).toBe(true);
    expect(ok(e({ source: "const", value: "x".repeat(4001) }))).toBe(false);
    for (const s of ["selection", "page_url", "page_text", "attachment", "user_id", "tenant_id"]) {
      expect(ok(e({ source: s }))).toBe(true);
      expect(ok(e({ source: s, value: "x" }))).toBe(false);
    }
    expect(ok(e({ source: "$args.x" }))).toBe(false);
    expect(ok(e({ source: "page" }))).toBe(false);
    expect(ok(InputMapSchema.safeParse({ "bad-key": { source: "selection" } }))).toBe(false);
    const many = Object.fromEntries(
      Array.from({ length: 51 }, (_, i) => [`k${i}`, { source: "selection" }]),
    );
    expect(ok(InputMapSchema.safeParse(many))).toBe(false);
  });

  it("ADM-FR-20 · M2-R15 · CommandOutput: field bắt buộc, render ∈ markdown|text|json", () => {
    expect(ok(CommandOutputSchema.safeParse({ field: "text", render: "json" }))).toBe(true);
    expect(ok(CommandOutputSchema.safeParse({ render: "json" }))).toBe(false);
    expect(ok(CommandOutputSchema.safeParse({ field: " ", render: "json" }))).toBe(false);
    expect(ok(CommandOutputSchema.safeParse({ field: "x", render: "html" }))).toBe(false);
  });

  it("ADM-FR-20 · M2-R15 · CommandCreateRequest: timeout 0/1/600/601, mode, feature_ids [] hợp lệ ở biên, mô tả", () => {
    const c = (o: Record<string, unknown>) => CommandCreateRequestSchema.safeParse(cmd(o));
    expect(ok(c({ timeout_s: 0 }))).toBe(false);
    expect(ok(c({ timeout_s: 1 }))).toBe(true);
    expect(ok(c({ timeout_s: 600 }))).toBe(true);
    expect(ok(c({ timeout_s: 601 }))).toBe(false);
    expect(ok(c({ timeout_s: 1.5 }))).toBe(false);
    expect(ok(c({ mode: "batch" }))).toBe(false);
    expect(ok(c({ feature_ids: [] }))).toBe(true);
    expect(ok(c({ feature_ids: [U1, U1] }))).toBe(false);
    expect(ok(c({ feature_ids: [U1, U2] }))).toBe(true);
    expect(ok(c({ feature_ids: uuids(51) }))).toBe(false);
    expect(ok(c({ description: { vi: "" } }))).toBe(false);
    expect(ok(c({ description: { vi: "x".repeat(201) } }))).toBe(false);
    const en = c({ description: { vi: "Dịch", en: "" } });
    expect(en.success && en.data.description).toEqual({ vi: "Dịch" });
    expect(
      ok(CommandCreateRequestSchema.safeParse({ ...cmd({}), output: { render: "json" } })),
    ).toBe(false);
  });

  it("ADM-FR-20 · M2-R25 · CommandUpdateRequest cần version; mọi trường khác tuỳ chọn; không nhận khoá lạ", () => {
    expect(ok(CommandUpdateRequestSchema.safeParse({ version: 1 }))).toBe(true);
    expect(ok(CommandUpdateRequestSchema.safeParse({ name: "x2" }))).toBe(false);
    expect(ok(CommandUpdateRequestSchema.safeParse({ version: 1, id: U1 }))).toBe(false);
    const both = CommandUpdateRequestSchema.safeParse({
      version: 1,
      enabled: false,
      mode: "async",
    });
    expect(ok(both)).toBe(true);
  });

  it("ADM-FR-22 · M2-R17 · InputMapWarning.reason ∈ type_mismatch|const_invalid; Command (response) có warnings/feature_ids", () => {
    const w = { var: "invoice_file", type: "file", source: "selection", reason: "type_mismatch" };
    expect(ok(InputMapWarningSchema.safeParse(w))).toBe(true);
    expect(ok(InputMapWarningSchema.safeParse({ ...w, reason: "other" }))).toBe(false);
    expect(Object.keys(CommandSchema.shape)).toEqual(
      expect.arrayContaining([
        "warnings",
        "feature_ids",
        "args",
        "input_map",
        "output",
        "timeout_s",
        "updated_by",
      ]),
    );
  });
});

describe("ADM-FR-30 · schema feature", () => {
  const feat = (o: Record<string, unknown> = {}) => ({
    key: "ke-toan",
    name: { vi: "Kế toán" },
    ...o,
  });

  it("ADM-FR-30 · M2-R20 · FeatureCreateRequest: key, tên, mô tả, icon, status, command_ids", () => {
    const f = (o: Record<string, unknown>) => FeatureCreateRequestSchema.safeParse(feat(o));
    const base = f({});
    expect(base.success && base.data.icon).toBe("package");
    expect(base.success && base.data.status).toBe("on");
    expect(ok(f({ key: "Ke Toan" }))).toBe(false);
    expect(ok(f({ name: { vi: "x".repeat(65) } }))).toBe(false);
    expect(ok(f({ name: { vi: "x".repeat(64) } }))).toBe(true);
    const en = f({ name: { vi: "Kế toán", en: "  " } });
    expect(en.success && en.data.name).toEqual({ vi: "Kế toán" });
    expect(ok(f({ description: { vi: "x".repeat(401) } }))).toBe(false);
    expect(ok(f({ description: {} }))).toBe(true);
    expect(ok(f({ icon: "Package" }))).toBe(false);
    expect(ok(f({ icon: "a".repeat(41) }))).toBe(false);
    expect(ok(f({ icon: "a_b" }))).toBe(false);
    expect(ok(f({ icon: "calculator" }))).toBe(true);
    expect(ok(f({ status: "disabled" }))).toBe(false);
    expect(ok(f({ command_ids: [U1, U1] }))).toBe(false);
    expect(ok(f({ command_ids: uuids(501) }))).toBe(false);
  });

  it("ADM-FR-30 · M2-R25 · FeatureUpdateRequest cần version, không nhận key", () => {
    expect(ok(FeatureUpdateRequestSchema.safeParse({ version: 1, command_ids: [U1] }))).toBe(true);
    expect(ok(FeatureUpdateRequestSchema.safeParse({ command_ids: [U1] }))).toBe(false);
    expect(ok(FeatureUpdateRequestSchema.safeParse({ version: 1, key: "abc" }))).toBe(false);
  });
});

describe("ADM-FR-10 · list, counts, details", () => {
  it("ADM-FR-10 · spec §3 · listResponseSchema(item, counts) và pageResponseSchema; counts từng danh sách", () => {
    expect(Object.keys(SecretListCountsSchema.shape)).toEqual(["all", "used", "unused"]);
    expect(Object.keys(WorkflowListCountsSchema.shape)).toEqual(["all", "on", "off", "unattached"]);
    expect(Object.keys(CommandListCountsSchema.shape)).toEqual(["all", "on", "off"]);
    expect(Object.keys(FeatureListCountsSchema.shape)).toEqual(["all", "on", "beta", "off"]);
    const L = listResponseSchema(SecretSchema, SecretListCountsSchema);
    const used = { all: 0, used: 0, unused: 0 };
    const m1 = { all: 0, active: 0, locked: 0 };
    expect(ok(L.safeParse({ items: [], total: 0, counts: used }))).toBe(true);
    expect(ok(L.safeParse({ items: [], total: 0, counts: m1 }))).toBe(false);
    expect(
      ok(listResponseSchema(SecretSchema).safeParse({ items: [], total: 0, counts: m1 })),
    ).toBe(true);
    const P = pageResponseSchema(SecretSchema);
    expect(ok(P.safeParse({ items: [], total: 0 }))).toBe(true);
    expect(ok(P.safeParse({ items: [], total: 0, counts: {} }))).toBe(false);
  });

  it("ADM-FR-22 · M2-R17 · *DetailsSchema strict: INPUT_MAP_INVALID đủ 3 khoá, WORKFLOW_IN_USE.action, INVALID_REFERENCE.field", () => {
    const full = { missing: ["a"], unknown: [], unknown_args: [] };
    expect(ok(InputMapInvalidDetailsSchema.safeParse(full))).toBe(true);
    expect(ok(InputMapInvalidDetailsSchema.safeParse({ missing: ["a"], unknown: [] }))).toBe(false);
    const u = { commands: [], agents: [] };
    expect(ok(WorkflowInUseDetailsSchema.safeParse({ action: "delete", ...u }))).toBe(true);
    expect(ok(WorkflowInUseDetailsSchema.safeParse({ action: "disable", ...u }))).toBe(true);
    expect(ok(WorkflowInUseDetailsSchema.safeParse({ action: "remove", ...u }))).toBe(false);
    for (const field of ["secret_id", "workflow_id", "feature_ids", "command_ids"]) {
      expect(ok(InvalidReferenceDetailsSchema.safeParse({ field, ids: [U1] }))).toBe(true);
    }
    expect(ok(InvalidReferenceDetailsSchema.safeParse({ field: "tenant_id", ids: [U1] }))).toBe(
      false,
    );
    const broken = { commands: [{ id: U1, name: "dich", missing: [], unknown: ["x"] }] };
    expect(ok(SchemaBreaksCommandsDetailsSchema.safeParse(broken))).toBe(true);
  });

  it("ADM-FR-10 · M2-R25 · versionConflictDetailsSchema dùng được cho Workflow, Command, FeatureDetail", () => {
    for (const s of [WorkflowSchema, CommandSchema, FeatureDetailSchema]) {
      const d = versionConflictDetailsSchema(s);
      expect(Object.keys(d.shape).sort()).toEqual(["current", "updated_at"]);
    }
  });
});
