// ADM-FR-10, ADM-FR-20, ADM-FR-30, ADM-FR-50 · 11 mã lỗi M2 ↔ API_ERRORS (test-plan E).
// 22 mã M1 do tests/acceptance/M1/error-codes.int.test.ts phụ trách.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  API_ERRORS,
  CommandNameTakenDetailsSchema,
  CommandNeedsFeatureDetailsSchema,
  CommandSchema,
  ErrorResponseSchema,
  FeatureDetailSchema,
  FeatureHasExclusiveCommandsDetailsSchema,
  InputMapInvalidDetailsSchema,
  InvalidReferenceDetailsSchema,
  SchemaBreaksCommandsDetailsSchema,
  SecretInUseDetailsSchema,
  versionConflictDetailsSchema,
  WorkflowDisabledDetailsSchema,
  WorkflowInUseDetailsSchema,
  WorkflowSchema,
} from "@ai/contracts";
import { ALL_CATALOG, ID } from "./_data";
import { createM2Env, expectErr, type M2Env, type Res } from "./_fixtures";

let env: M2Env;
beforeAll(async () => {
  env = await createM2Env({ catalog: ALL_CATALOG });
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await env.reset(ALL_CATALOG);
});

const as = async (method: string, path: string, body?: unknown): Promise<Res> =>
  env.call(method, path, { token: await env.admin(), body });
const W = ID.workflow;
const cmdBody = (over: Record<string, unknown> = {}) => ({
  name: "moi-cmd",
  description: { vi: "Mô tả" },
  workflow_id: W.translate,
  args: [
    { name: "lang", description: { vi: "Ngôn ngữ" } },
    { name: "text", description: { vi: "Văn bản" }, rest: true },
  ],
  input_map: {
    source_text: { source: "arg", value: "text" },
    target_lang: { source: "arg", value: "lang" },
  },
  output: { field: "text", render: "markdown" },
  ...over,
});

const M1_CODES = [
  "VALIDATION_ERROR",
  "TENANT_REQUIRED",
  "ROLE_NOT_ALLOWED",
  "EMAIL_REQUIRED",
  "PASSWORD_UNCHANGED",
  "INVALID_CURRENT_PASSWORD",
  "UNAUTHORIZED",
  "INVALID_CREDENTIALS",
  "INVALID_REFRESH_TOKEN",
  "REFRESH_SUPERSEDED",
  "INVALID_CHANGE_TOKEN",
  "FORBIDDEN",
  "ACCOUNT_LOCKED",
  "SELF_ACTION_FORBIDDEN",
  "NOT_FOUND",
  "VERSION_CONFLICT",
  "KEY_TAKEN",
  "USERNAME_TAKEN",
  "EMAIL_TAKEN",
  "LAST_ADMIN",
  "PLATFORM_TENANT_LOCKED",
  "TEMP_LOCKED",
  "INTERNAL_ERROR",
];
const M2_CODES = Object.keys(API_ERRORS)
  .filter((c) => !M1_CODES.includes(c))
  .sort();

type Scenario = () => Promise<Res>;
const SCENARIOS: Record<string, { run: Scenario; details?: (d: unknown) => unknown }> = {
  SECRET_NAME_TAKEN: {
    run: () => as("POST", "/admin/secrets", { name: "DIFY_OLD_KEY", value: "12345678" }),
  },
  SECRET_IN_USE: {
    run: () => as("DELETE", "/admin/secrets/DIFY_TRANSLATE_KEY"),
    details: (d) => SecretInUseDetailsSchema.parse(d),
  },
  INVALID_REFERENCE: {
    run: () =>
      as("POST", "/admin/workflows", {
        key: "moi-wf",
        name: "Moi",
        description: "d".repeat(30),
        app_type: "workflow",
        base_url: "https://x.example.com",
        secret_id: ID.unknown,
      }),
    details: (d) => InvalidReferenceDetailsSchema.parse(d),
  },
  WORKFLOW_IN_USE: {
    run: () => as("DELETE", `/admin/workflows/${W.translate}`),
    details: (d) => WorkflowInUseDetailsSchema.parse(d),
  },
  SCHEMA_BREAKS_COMMANDS: {
    run: () =>
      as("PATCH", `/admin/workflows/${W.translate}`, {
        version: 1,
        input_schema: [
          { name: "source_text", type: "text", required: true, description: "Văn bản" },
        ],
      }),
    details: (d) => SchemaBreaksCommandsDetailsSchema.parse(d),
  },
  WORKFLOW_DISABLED: {
    run: () =>
      as(
        "POST",
        "/admin/commands",
        cmdBody({ workflow_id: W.reportExport, args: [], input_map: {} }),
      ),
    details: (d) => WorkflowDisabledDetailsSchema.parse(d),
  },
  COMMAND_NAME_TAKEN: {
    run: () => as("POST", "/admin/commands", cmdBody({ name: "dich" })),
    details: (d) => CommandNameTakenDetailsSchema.parse(d),
  },
  INPUT_MAP_INVALID: {
    run: () => as("POST", "/admin/commands", cmdBody({ input_map: {} })),
    details: (d) => {
      const v = InputMapInvalidDetailsSchema.parse(d);
      expect(v.missing).toEqual(["source_text", "target_lang"]);
      return v;
    },
  },
  COMMAND_NEEDS_FEATURE: {
    run: () => as("POST", "/admin/commands", cmdBody({ feature_ids: [] })),
    details: (d) => expect(d).toBeUndefined(),
  },
  CORE_FEATURE_PROTECTED: {
    run: async () => as("DELETE", `/admin/features/${await env.coreId()}`),
  },
  FEATURE_HAS_EXCLUSIVE_COMMANDS: {
    run: () => as("DELETE", `/admin/features/${ID.feature.keToan}`),
    details: (d) => FeatureHasExclusiveCommandsDetailsSchema.parse(d),
  },
};

/** Giá trị định danh trong dữ liệu gây lỗi: `message` (cố định theo mã) không được chứa. */
const IDENTIFIERS = [
  "DIFY_OLD_KEY",
  "DIFY_TRANSLATE_KEY",
  "translate",
  "dich",
  "ke-toan",
  "tr-nhanh",
];
const covered = new Set<string>();

describe("ADM-FR-10 · mã lỗi M2 ↔ API_ERRORS", () => {
  for (const code of Object.keys(SCENARIOS)) {
    it(`ADM-FR-10 · spec M2 §3 · ${code} → HTTP ${API_ERRORS[code as keyof typeof API_ERRORS]}, body ErrorResponse, message tiếng Anh cố định không chứa dữ liệu người dùng, details đúng schema`, async () => {
      const scenario = SCENARIOS[code];
      if (!scenario) throw new Error(`thiếu kịch bản ${code}`);
      const res = await scenario.run();
      covered.add(code);
      expectErr(res, code as keyof typeof API_ERRORS);
      const err = ErrorResponseSchema.parse(res.json).error;
      expect(err.message).toMatch(/^[\x20-\x7e]+$/);
      expect(err.message.length).toBeGreaterThan(0);
      if (code !== "CORE_FEATURE_PROTECTED") {
        for (const id of IDENTIFIERS) expect(err.message).not.toContain(id);
      }
      scenario.details?.(err.details);
    });
  }

  it("ADM-FR-20 · M2-R19 · COMMAND_NEEDS_FEATURE từ PATCH /admin/features/:id có details {commands:[{id,name}]}", async () => {
    const res = await as("PATCH", `/admin/features/${ID.feature.keToan}`, {
      version: 1,
      command_ids: [ID.command.tomTat],
    });
    expectErr(res, "COMMAND_NEEDS_FEATURE");
    CommandNeedsFeatureDetailsSchema.parse(res.json.error.details);
  });

  it("ADM-FR-10 · message cố định theo mã: COMMAND_NAME_TAKEN, SECRET_IN_USE, INVALID_REFERENCE cho dữ liệu khác nhau cho CÙNG message", async () => {
    const a = await as("POST", "/admin/commands", cmdBody({ name: "dich" }));
    const b = await as("POST", "/admin/commands", cmdBody({ name: "tom-tat" }));
    expect(a.json.error.message).toBe(b.json.error.message);
    const s1 = await as("DELETE", "/admin/secrets/DIFY_TRANSLATE_KEY");
    const s2 = await as("DELETE", "/admin/secrets/DIFY_INVOICE_KEY");
    expect(s1.json.error.message).toBe(s2.json.error.message);
    const r1 = await as("POST", "/admin/commands", cmdBody({ workflow_id: ID.unknown }));
    const r2 = await as("POST", "/admin/commands", cmdBody({ feature_ids: [ID.unknown] }));
    expect(r1.json.error.message).toBe(r2.json.error.message);
  });

  it("ADM-FR-10 · ADM-FR-30 · KEY_TAKEN cho workflow và feature: 409, message 'Key is already taken'", async () => {
    const wf = await as("POST", "/admin/workflows", {
      key: "translate",
      name: "T",
      description: "d".repeat(30),
      app_type: "workflow",
      base_url: "https://x.example.com",
      secret_id: ID.secret.translate,
    });
    const ft = await as("POST", "/admin/features", { key: "core", name: { vi: "X" } });
    for (const res of [wf, ft]) {
      expectErr(res, "KEY_TAKEN");
      expect(res.json.error.message).toBe("Key is already taken");
    }
  });

  it("ADM-FR-10 · M2-R25 · VERSION_CONFLICT của Workflow, Command, FeatureDetail: versionConflictDetailsSchema(...) và updated_at == current.updated_at", async () => {
    const cases: Array<
      [string, Record<string, unknown>, Parameters<typeof versionConflictDetailsSchema>[0]]
    > = [
      [`/admin/workflows/${W.reportTax}`, { name: "Khác" }, WorkflowSchema],
      [`/admin/commands/${ID.command.dich}`, { description: { vi: "Khác" } }, CommandSchema],
      [`/admin/features/${ID.feature.keToan}`, { name: { vi: "Khác" } }, FeatureDetailSchema],
    ];
    for (const [path, over, schema] of cases) {
      const res = await as("PATCH", path, { version: 99, ...over });
      expectErr(res, "VERSION_CONFLICT");
      const d = versionConflictDetailsSchema(schema).parse(res.json.error.details) as {
        updated_at: string;
        current: { updated_at: string };
      };
      expect(d.updated_at).toBe(d.current.updated_at);
    }
  });

  it("ADM-FR-10 · spec M2 §3 · tập mã M2 đã chạy kịch bản == mọi mã của API_ERRORS ngoài 23 mã M1 (11 mã)", () => {
    expect(M2_CODES).toHaveLength(11);
    expect([...covered].sort()).toEqual(M2_CODES);
  });
});
