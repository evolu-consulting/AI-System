import { describe, expect, test } from "bun:test";
import {
  DifyCredentialResponseSchema,
  ErrorResponseSchema,
  HUB_INTERNAL_ERRORS,
  MCP_PROTOCOL_VERSIONS,
  TestRunRequestSchema,
  TestRunResponseSchema,
  ToolConfirmationRequiredSchema,
} from "./index";

const U = "11111111-1111-4111-8111-111111111111";

describe("HUB-FR-89 · hub-internal", () => {
  test("HUB-FR-89 · mã lỗi → status, body ErrorResponse", () => {
    expect(HUB_INTERNAL_ERRORS).toEqual({
      VALIDATION_ERROR: 400,
      UNAUTHORIZED: 401,
      NOT_CONFIGURED: 409,
      CMD_MISSING_ARG: 422,
      INTERNAL_ERROR: 500,
      UNAVAILABLE: 503,
    });
    for (const code of Object.keys(HUB_INTERNAL_ERRORS)) {
      expect(ErrorResponseSchema.safeParse({ error: { code, message: "m" } }).success).toBe(true);
    }
  });

  test("WRK-FR-07 · DifyCredentialResponse", () => {
    const c = { base_url: "https://d/v1", api_key: "app-1", app_type: "chat" };
    expect(DifyCredentialResponseSchema.parse(c)).toEqual(c as never);
    expect(DifyCredentialResponseSchema.safeParse({ ...c, base_url: "d/v1" }).success).toBe(false);
    expect(DifyCredentialResponseSchema.safeParse({ ...c, api_key: "" }).success).toBe(false);
    expect(DifyCredentialResponseSchema.safeParse({ ...c, extra: 1 }).success).toBe(false);
  });

  test("ADM-FR-24 · TestRunRequest điền mặc định, từ chối trường lạ", () => {
    const req = {
      command: { workflow_id: U, output: { field: "result", render: "markdown" } },
      text: "",
      actor_user_id: U,
    };
    const out = TestRunRequestSchema.parse(req);
    expect(out.command.args).toEqual([]);
    expect(out.command.input_map).toEqual({});
    expect(out.command.timeout_s).toBe(30);
    expect(TestRunRequestSchema.safeParse({ ...req, extra: 1 }).success).toBe(false);
    expect(TestRunRequestSchema.safeParse({ ...req, text: "x".repeat(16_001) }).success).toBe(
      false,
    );
  });

  test("ADM-FR-24 · TestRunResponse ok/lỗi", () => {
    const tail = {
      steps: [{ label: "Đang chạy lệnh", status: "ok", ms: 5 }],
      usage: { input_tokens: 1, output_tokens: 2, cost_usd: 0 },
      ms: 9,
    };
    expect(TestRunResponseSchema.safeParse({ ok: true, output: "x", ...tail }).success).toBe(true);
    const err = { code: "NOT_CONFIGURED", message: "m", detail: null };
    expect(TestRunResponseSchema.safeParse({ ok: false, error: err, ...tail }).success).toBe(true);
    expect(
      TestRunResponseSchema.safeParse({ ok: false, error: { ...err, code: "NOPE" }, ...tail })
        .success,
    ).toBe(false);
  });

  test("HUB-FR-95 · MCP: phiên bản, xác nhận side_effect", () => {
    expect(MCP_PROTOCOL_VERSIONS[0]).toBe("2026-07-28");
    const c = { code: "CONFIRMATION_REQUIRED", question: "Tiếp tục?", choices: ["Đồng ý", "Huỷ"] };
    expect(ToolConfirmationRequiredSchema.parse(c)).toEqual(c as never);
    expect(ToolConfirmationRequiredSchema.safeParse({ ...c, choices: ["a"] }).success).toBe(false);
  });
});
