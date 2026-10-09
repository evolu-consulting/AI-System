// ADM-FR-54 · ADM-BR-04 · ADM-FR-08 · contract khối C (`packages/contracts/src/transfer.ts`, plan-cd §3) + đếm
// `API_ERRORS` (D-K04, plan-cd §4.3). Xanh ở T7. Schema D (totp) ở `contracts-totp.test.ts` (xanh T9d).
import { describe, expect, it } from "bun:test";
import { API_ERRORS } from "@ai/contracts";
import { loadTransferContract } from "../_cd-modules";
import { fileOf, ruleSnapshot } from "../_transfer-data";

const ok = (r: { success: boolean }) => r.success;
// biome-ignore lint/suspicious/noExplicitAny: mẫu dựng tay
type Obj = Record<string, any>;
const sample = (): Obj => {
  const f = fileOf(ruleSnapshot());
  f.tenants[0].quotas = [
    { feature: null, max_runs: 1000 },
    { feature: "ke-toan", max_usd: "300.00" },
  ];
  return f;
};

describe("ADM-FR-54 · ConfigFileSchema", () => {
  it("ADM-FR-54 · C-K01 · ADM-BR-04 · mẫu đủ 6 loại qua; khoá lạ, format sai, secret có value/last4, secret_id, quota toàn null → fail", async () => {
    const { ConfigFileSchema: S } = await loadTransferContract();
    expect(ok(S.safeParse(sample()))).toBe(true);
    const bad: Array<(f: Obj) => void> = [
      (f) => {
        f.extra = 1;
      },
      (f) => {
        f.workflows[0].foo = 1;
      },
      (f) => {
        f.format = "other/config";
      },
      (f) => {
        f.format_version = 2;
      },
      (f) => {
        f.secrets[0].value = "sk-LEAK-Q7Zp3XvR9mT2LwB5nJc8YdHa";
      },
      (f) => {
        f.secrets[0].last4 = "7f3a";
      },
      (f) => {
        f.workflows[0].secret_id = "01900000-0000-7000-8000-000000000201";
      },
      (f) => {
        f.tenants[0].quotas = [{ feature: null, max_runs: null, max_tokens: null, max_usd: null }];
      },
    ];
    for (const mutate of bad) {
      const f = sample();
      mutate(f);
      expect(ok(S.safeParse(f))).toBe(false);
    }
  });

  it("ADM-FR-54 · C-K02 · ImportRequestSchema: x.YML qua; x.json, tên 256 ký tự, khoá lạ, base_config_version -1 → fail", async () => {
    const { ImportRequestSchema: S } = await loadTransferContract();
    const base = { file_name: "x.YML", content: "format: ai-system/config\n" };
    expect(ok(S.safeParse(base))).toBe(true);
    expect(
      ok(
        S.safeParse({
          ...base,
          base_config_version: 3,
          secrets: { DIFY_REPORT_KEY: "sk-abcdefgh" },
        }),
      ),
    ).toBe(true);
    expect(ok(S.safeParse({ ...base, file_name: "x.json" }))).toBe(false);
    expect(ok(S.safeParse({ ...base, file_name: `${"a".repeat(251)}.yaml` }))).toBe(false);
    expect(ok(S.safeParse({ ...base, extra: 1 }))).toBe(false);
    expect(ok(S.safeParse({ ...base, base_config_version: -1 }))).toBe(false);
  });

  it("ADM-FR-54 · C-K03 · ImportPreviewSchema / ImportResultSchema: mẫu qua; op 'delete' fail; errors[].code ngoài 9 mã fail (CR-055 gỡ COMMAND_NEEDS_FEATURE)", async () => {
    const { ImportPreviewSchema: P, ImportResultSchema: R } = await loadTransferContract();
    const codes = [
      "YAML_SYNTAX",
      "SCHEMA",
      "DUPLICATE_KEY",
      "REF_NOT_FOUND",
      "TENANT_NOT_FOUND",
      "PLATFORM_TENANT",
      "NOT_ENTITLED",
      "RULE",
      "TOO_MANY_ERRORS",
    ];
    const preview = {
      valid: true,
      file_name: "config-v7.yaml",
      from_config_version: 7,
      base_config_version: 8,
      summary: { added: 1, updated: 0, unchanged: 2 },
      items: [
        {
          type: "workflow",
          key: "report-new",
          op: "add",
          before: null,
          after: { key: "report-new" },
        },
      ],
      missing_secrets: [{ name: "DIFY_REPORT_KEY", used_by: ["report-new"] }],
      errors: [],
    };
    expect(ok(P.safeParse(preview))).toBe(true);
    const errs = codes.map((code) => ({
      path: "commands[0].workflow",
      code,
      message: "Lỗi",
      line: 3,
      col: 1,
    }));
    expect(ok(P.safeParse({ ...preview, valid: false, errors: errs }))).toBe(true);
    const del = { ...preview, items: [{ ...preview.items[0], op: "delete" }] };
    expect(ok(P.safeParse(del))).toBe(false);
    const other = {
      ...preview,
      valid: false,
      errors: [{ path: "x", code: "OTHER", message: "x" }],
    };
    expect(ok(P.safeParse(other))).toBe(false);
    const gone = { ...other, errors: [{ path: "x", code: "COMMAND_NEEDS_FEATURE", message: "x" }] };
    expect(ok(P.safeParse(gone))).toBe(false);
    const result = {
      config_version: 9,
      summary: { added: 1, updated: 2, unchanged: 0 },
      secrets_created: 1,
    };
    expect(ok(R.safeParse(result))).toBe(true);
    expect(ok(R.safeParse({ ...result, extra: 1 }))).toBe(false);
  });
});

describe("ADM-FR-08 · ADM-FR-54 · API_ERRORS M4", () => {
  it("ADM-FR-54 · D-K04 · API_ERRORS có đúng 46 mã (48 − 2 theo CR-055); gồm 9 mã khối C + D với HTTP đúng", () => {
    expect(Object.keys(API_ERRORS).length).toBe(46);
    expect(API_ERRORS).toMatchObject({
      PAYLOAD_TOO_LARGE: 413,
      IMPORT_INVALID: 400,
      SECRETS_REQUIRED: 400,
      INVALID_TOTP_TOKEN: 401,
      INVALID_OTP: 401,
      INVALID_CURRENT_CODE: 400,
      TOTP_ALREADY_ENABLED: 409,
      TOTP_NOT_ENABLED: 409,
      TOTP_SETUP_EXPIRED: 409,
    });
  });
});
