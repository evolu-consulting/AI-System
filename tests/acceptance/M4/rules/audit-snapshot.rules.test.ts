// ADM-FR-51, ADM-BR-04 · M4-R10 · hàm thuần `lib/audit/audit.rules.ts` (test-plan R14–R15; chữ ký plan-rules §A1,
// allowlist plan §4.1). Xanh ở T1. Module nạp động (`_modules.ts`): trước T1 mỗi ca đỏ vì "Cannot find module".
import { describe, expect, it } from "bun:test";
import { loadAuditSnapshot } from "../_modules";

const S = () => loadAuditSnapshot();
const X = "01900000-0000-7000-8000-000000000401";

/** Allowlist plan §4.1 (snake_case như DTO). `user` có thể thêm `totp_enabled` (plan-cd). */
const ALLOW: Record<string, string[]> = {
  tenant: ["key", "name", "active", "max_concurrent_sub", "version"],
  user: [
    "username",
    "display_name",
    "email",
    "role",
    "locale",
    "active",
    "locked_by_tenant",
    "must_change_password",
    "version",
  ],
  user_totp: ["enabled", "backup_codes_left"],
  group: ["key", "name", "description", "version"],
  grant: ["feature_id", "subject_type", "subject_id"],
  entitlement: ["feature_id", "tenant_id"],
  feature: ["key", "name", "description", "icon", "status", "command_ids", "version"],
  workflow: [
    "key",
    "name",
    "description",
    "app_type",
    "base_url",
    "secret_id",
    "input_schema",
    "output_field",
    "enabled",
    "version",
  ],
  command: [
    "name",
    "aliases",
    "description",
    "workflow_id",
    "args",
    "input_map",
    "output",
    "mode",
    "timeout_s",
    "enabled",
    "feature_ids",
    "version",
  ],
  secret: ["name", "note"],
  quota: ["items"],
  config: ["from_config_version", "added", "updated", "secrets_created", "truncated"],
};
const OPTIONAL: Record<string, string[]> = { user: ["totp_enabled"] };

const FORBIDDEN = [
  "password",
  "password_hash",
  "totp_secret",
  "ciphertext",
  "iv",
  "token_hash",
  "value",
  "backup_codes",
  "code_hash",
];

/** Giá trị mẫu theo trường (đủ hợp lệ để so khớp; hàm thuần không validate kiểu). */
function sample(field: string): unknown {
  if (field === "items")
    return [
      {
        feature_id: null,
        feature_key: null,
        max_runs: 1000,
        max_tokens: null,
        max_usd: "300.00",
      },
    ];
  if (field.endsWith("_ids") || field === "aliases" || field === "args") return [X];
  if (field === "input_schema" || field === "input_map" || field === "name") return { vi: field };
  if (/^(active|enabled|locked_by_tenant|must_change_password|truncated|totp_enabled)$/.test(field))
    return true;
  if (/(version|_s|_sub|_left|^added$|^updated$|^secrets_created$)$/.test(field)) return 3;
  return `v-${field}`;
}

/** DTO đủ trường allowlist + trường thừa nhạy cảm/không thuộc snapshot. */
function dto(entity: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of [...(ALLOW[entity] ?? []), ...(OPTIONAL[entity] ?? [])]) out[f] = sample(f);
  return {
    ...out,
    id: X,
    password_hash: "$argon2id$v=19$m=19456,t=2,p=1$abc$def",
    last4: "Zp3X",
    updated_at: "2026-10-01T00:00:00.000Z",
  };
}

describe("ADM-FR-51 · M4-R10 · auditSnapshot allowlist (12 entity)", () => {
  it("ADM-FR-51 · M4-R10 · AUDIT_FIELDS có đúng 12 entity của AUDIT_ENTITIES; FORBIDDEN_AUDIT_KEYS đúng 9 khoá", async () => {
    const { AUDIT_FIELDS, FORBIDDEN_AUDIT_KEYS, USER_DEFINED_AUDIT_FIELDS } = await S();
    expect(Object.keys(AUDIT_FIELDS).sort()).toEqual(Object.keys(ALLOW).sort());
    expect([...FORBIDDEN_AUDIT_KEYS].sort()).toEqual([...FORBIDDEN].sort());
    expect([...USER_DEFINED_AUDIT_FIELDS].sort()).toEqual(
      ["args", "input_map", "input_schema", "output"].sort(),
    );
  });

  for (const entity of Object.keys(ALLOW)) {
    it(`ADM-FR-51 · ADM-BR-04 · M4-R10 · ${entity}: chỉ giữ trường allowlist (bỏ id, password_hash, last4, updated_at), giá trị giữ nguyên`, async () => {
      const { auditSnapshot } = await S();
      const input = dto(entity);
      const out = auditSnapshot(entity, input) as Record<string, unknown>;
      const keys = Object.keys(out).sort();
      const base = [...(ALLOW[entity] ?? [])].sort();
      const withOpt = [...base, ...(OPTIONAL[entity] ?? [])].sort();
      expect([JSON.stringify(base), JSON.stringify(withOpt)]).toContain(JSON.stringify(keys));
      for (const k of keys) expect(out[k]).toEqual(input[k]);
    });
  }

  it("ADM-BR-04 · M4-R10 · secret: chỉ name, note — không last4, không giá trị/bản mã", async () => {
    const { auditSnapshot } = await S();
    const out = auditSnapshot("secret", {
      name: "DIFY_KEY",
      note: "n",
      last4: "Zp3X",
      value: "sk-LEAK-Q7Zp3XvR9mT2LwB5nJc8YdHa",
      ciphertext: "AAAA",
      iv: "BBBB",
      version: 2,
    });
    expect(out).toEqual({ name: "DIFY_KEY", note: "n" });
  });

  it("ADM-FR-51 · M4-R10 · quota: items giữ feature_id, feature_key, max_runs, max_tokens, max_usd", async () => {
    const { auditSnapshot } = await S();
    const items = [
      { feature_id: null, feature_key: null, max_runs: 1000, max_tokens: null, max_usd: null },
      {
        feature_id: X,
        feature_key: "ke-toan",
        max_runs: null,
        max_tokens: null,
        max_usd: "300.00",
      },
    ];
    const out = auditSnapshot("quota", { tenant_id: X, version: 4, month: "2026-10", items });
    expect(Object.keys(out)).toEqual(["items"]);
    expect(out.items).toMatchObject(items);
  });
});

describe("ADM-BR-04 · M4-R10 · khoá cấm", () => {
  it("ADM-BR-04 · M4-R10 · containsForbiddenKey: mỗi khoá cấm ở độ sâu 3 (trong mảng) → true; đối tượng sạch → false", async () => {
    const { containsForbiddenKey } = await S();
    for (const k of FORBIDDEN) {
      expect(containsForbiddenKey({ a: [{ b: { [k]: "x" } }] })).toBe(true);
    }
    expect(containsForbiddenKey({ a: [{ b: { name: "x", note: null } }], c: [1, "value"] })).toBe(
      false,
    );
    expect(containsForbiddenKey(null)).toBe(false);
  });

  it("ADM-FR-51 · M4-R10 · auditSnapshot KHÔNG ném khi command.input_map / workflow.input_schema có khoá password/value/iv (nội dung người dùng định nghĩa), giữ nguyên", async () => {
    const { auditSnapshot } = await S();
    const input_map = { password: "{{args.pw}}", value: "{{text}}", iv: "x" };
    const cmd = { ...dto("command"), input_map };
    const out = auditSnapshot("command", cmd) as Record<string, unknown>;
    expect(out.input_map).toEqual(input_map);
    const input_schema = { type: "object", properties: { password: { type: "string" } } };
    const wf = auditSnapshot("workflow", { ...dto("workflow"), input_schema }) as Record<
      string,
      unknown
    >;
    expect(wf.input_schema).toEqual(input_schema);
  });
});
