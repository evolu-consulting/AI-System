// ADM-FR-51, ADM-BR-04 · M4-R10 · snapshot audit thuần (plan M4 §4.1, plan-rules §A1): allowlist theo entity, chặn khoá
// cấm ở cấp 1. Không I/O. Đổi allowlist = đổi contract (backend-lead).
import type { AuditEntity } from "@ai/contracts";

type Dto = Readonly<Record<string, unknown>>;

/** Allowlist `before/after` theo entity (snake_case như DTO). `user.totp_enabled` thêm ở plan-cd (tuỳ có trong DTO). */
export const AUDIT_FIELDS: Readonly<Record<AuditEntity, readonly string[]>> = {
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
    "totp_enabled",
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

export const FORBIDDEN_AUDIT_KEYS: readonly string[] = [
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

/** Nội dung người dùng định nghĩa: khoá bên trong (vd `password` của input_schema) là dữ liệu hợp lệ, không quét. */
export const USER_DEFINED_AUDIT_FIELDS: readonly string[] = [
  "input_map",
  "input_schema",
  "args",
  "output",
];

const FORBIDDEN = new Set(FORBIDDEN_AUDIT_KEYS);

/**
 * Pick allowlist (chỉ khoá có mặt trong `dto`, giá trị giữ nguyên). Ném nếu khoá cấp 1 của kết quả là khoá cấm
 * (lỗi lập trình: allowlist bị sửa sai). Không duyệt sâu vào `USER_DEFINED_AUDIT_FIELDS`.
 */
export function auditSnapshot(entity: AuditEntity, dto: Dto): Record<string, unknown> {
  const fields = AUDIT_FIELDS[entity];
  if (!fields) throw new Error(`auditSnapshot: entity lạ ${String(entity)}`);
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (Object.hasOwn(dto, f)) out[f] = dto[f];
  }
  for (const k of Object.keys(out)) {
    if (FORBIDDEN.has(k)) throw new Error(`auditSnapshot: khoá cấm ${k} trong ${entity}`);
  }
  return out;
}

/** Đệ quy mọi độ sâu (mảng + đối tượng): có khoá nào ∈ `FORBIDDEN_AUDIT_KEYS` không. Tiện ích cho test/kiểm DTO. */
export function containsForbiddenKey(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(containsForbiddenKey);
  if (v === null || typeof v !== "object") return false;
  for (const [k, x] of Object.entries(v)) {
    if (FORBIDDEN.has(k) || containsForbiddenKey(x)) return true;
  }
  return false;
}
