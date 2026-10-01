import { describe, expect, test } from "bun:test";
import {
  BaseUrlSchema,
  InputSchemaSchema,
  versionConflictDetailsSchema,
  type Workflow,
  WorkflowCreateRequestSchema,
  WorkflowInputSchema,
  WorkflowListQuerySchema,
  WorkflowListResponseSchema,
  WorkflowSchema,
  WorkflowUpdateRequestSchema,
  WorkflowUsagesSchema,
} from "./index";
import { TENANT_ID as ID, USER_ID as SECRET_ID, T0, T1 } from "./test-fixtures";

const DESC = "Dịch văn bản sang ngôn ngữ đích"; // 31 ký tự
const input = { name: "source_text", type: "text", required: true, description: "Văn bản gốc" };
const workflow: Workflow = {
  id: ID,
  key: "translate",
  name: "Dịch",
  app_type: "workflow",
  description: DESC,
  enabled: true,
  secret: { id: SECRET_ID, name: "DIFY_TRANSLATE_KEY" },
  command_count: 1,
  agent_count: 0,
  unattached: false,
  version: 1,
  updated_at: T1,
  updated_by: null,
  base_url: "https://dify.local/v1",
  input_schema: [{ name: "source_text", type: "text", required: true, description: "Văn bản gốc" }],
  output_field: null,
  created_at: T0,
};
const create = {
  key: "translate",
  name: "Dịch",
  description: DESC,
  app_type: "workflow",
  base_url: "https://dify.local/v1",
  secret_id: SECRET_ID,
};

describe("ADM-FR-11 · M2-R08 · WorkflowInput / InputSchema", () => {
  test("select cần options, loại khác cấm options", () => {
    const sel = { ...input, type: "select", options: ["vi", "en"] };
    expect(WorkflowInputSchema.safeParse(sel).success).toBe(true);
    expect(WorkflowInputSchema.safeParse({ ...input, type: "select" }).success).toBe(false);
    expect(WorkflowInputSchema.safeParse({ ...input, options: ["a"] }).success).toBe(false);
    expect(WorkflowInputSchema.safeParse({ ...sel, options: [] }).success).toBe(false);
    expect(WorkflowInputSchema.safeParse({ ...sel, options: ["a", "a"] }).success).toBe(false);
  });

  test.each([
    ["mô tả rỗng sau trim", { ...input, description: "  " }],
    ["mô tả 401", { ...input, description: "a".repeat(401) }],
    ["tên bắt đầu bằng số", { ...input, name: "1x" }],
    ["type lạ", { ...input, type: "date" }],
    ["thiếu required", { name: "a", type: "text", description: "x" }],
    ["trường lạ", { ...input, default: "x" }],
  ])("từ chối: %s", (_n, v) => {
    expect(WorkflowInputSchema.safeParse(v).success).toBe(false);
  });

  test("tên không trùng (issue tại [i, name]); tối đa 50", () => {
    const r = InputSchemaSchema.safeParse([input, input]);
    expect(r.error?.issues[0]?.path).toEqual([1, "name"]);
    const many = Array.from({ length: 51 }, (_, i) => ({ ...input, name: `p${i}` }));
    expect(InputSchemaSchema.safeParse(many).success).toBe(false);
    expect(InputSchemaSchema.safeParse(many.slice(0, 50)).success).toBe(true);
  });
});

describe("ADM-FR-10 · M2-R07 · create/update", () => {
  test("mặc định input_schema [], output_field null, enabled true; key chuẩn hoá", () => {
    const r = WorkflowCreateRequestSchema.parse({ ...create, key: " Translate " });
    expect(r).toMatchObject({ key: "translate", input_schema: [], output_field: null });
    expect(r.enabled).toBe(true);
  });

  test("mô tả 19 → lỗi, 20 → được, 400 → được, 401 → lỗi (đếm sau trim)", () => {
    const d = (n: number) => ({ ...create, description: ` ${"a".repeat(n)} ` });
    expect(WorkflowCreateRequestSchema.safeParse(d(19)).success).toBe(false);
    expect(WorkflowCreateRequestSchema.safeParse(d(20)).success).toBe(true);
    expect(WorkflowCreateRequestSchema.safeParse(d(400)).success).toBe(true);
    expect(WorkflowCreateRequestSchema.safeParse(d(401)).success).toBe(false);
  });

  test.each([
    ["ftp", "ftp://dify.local"],
    ["thiếu //", "http:dify.local"],
    ["hoa", "HTTPS://dify.local"],
    ["userinfo", "https://u:p@dify.local"],
    ["chỉ username", "https://u@dify.local"],
    ["không phải URL", "https://"],
    ["2049 ký tự", `https://a.b/${"x".repeat(2037)}`],
  ])("base_url từ chối: %s", (_n, url) => {
    expect(BaseUrlSchema.safeParse(url).success).toBe(false);
  });

  test("base_url nhận http/https, cổng, đường dẫn", () => {
    for (const url of ["http://localhost:5001/v1", "https://api.dify.ai/v1"])
      expect(BaseUrlSchema.safeParse(url).success).toBe(true);
  });

  test("update: không có key; version bắt buộc; output_field null được", () => {
    expect(WorkflowUpdateRequestSchema.safeParse({ version: 1, key: "x" }).success).toBe(false);
    expect(WorkflowUpdateRequestSchema.safeParse({ name: "x" }).success).toBe(false);
    expect(WorkflowUpdateRequestSchema.parse({ version: 2, output_field: null })).toEqual({
      version: 2,
      output_field: null,
    });
  });
});

describe("ADM-FR-14 · ADM-FR-15 · response", () => {
  test("Workflow strict; unattached khớp đếm", () => {
    expect(WorkflowSchema.parse(workflow)).toEqual(workflow);
    expect(WorkflowSchema.safeParse({ ...workflow, unattached: true }).success).toBe(false);
    const free = { ...workflow, command_count: 0, unattached: true };
    expect(WorkflowSchema.safeParse(free).success).toBe(true);
    expect(WorkflowSchema.safeParse({ ...workflow, secret_id: SECRET_ID }).success).toBe(false);
  });

  test("list query + counts {all,on,off,unattached}", () => {
    expect(
      WorkflowListQuerySchema.parse({ attached: "false", status: "off", secret: "dify_key" }),
    ).toEqual({ attached: false, status: "off", secret: "DIFY_KEY", limit: 50, offset: 0 });
    expect(WorkflowListQuerySchema.safeParse({ status: "beta" }).success).toBe(false);
    const { base_url, input_schema, output_field, created_at, ...item } = workflow;
    const ok = { items: [item], total: 1, counts: { all: 1, on: 1, off: 0, unattached: 0 } };
    expect(WorkflowListResponseSchema.parse(ok)).toEqual(ok);
  });

  test("usages: agents_available=false thì agents rỗng", () => {
    const u = {
      commands: [{ id: ID, name: "dich", enabled: true }],
      agents: [{ id: ID }],
      command_count: 1,
      agent_count: 1,
      agents_available: true,
    };
    expect(WorkflowUsagesSchema.parse(u)).toEqual(u);
    expect(WorkflowUsagesSchema.safeParse({ ...u, agents_available: false }).success).toBe(false);
    const none = { ...u, agents: [], agent_count: 0, agents_available: false };
    expect(WorkflowUsagesSchema.safeParse(none).success).toBe(true);
  });

  test("VERSION_CONFLICT details theo WorkflowSchema", () => {
    const s = versionConflictDetailsSchema(WorkflowSchema);
    expect(s.safeParse({ current: workflow, updated_at: T1 }).success).toBe(true);
  });
});
