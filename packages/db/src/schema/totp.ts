// ADM-FR-08 · ADM-BR-04 · M4-R10, R16 · schema 2FA (plan-cd §5, D1–D3): `user_totp` (secret mã hoá AES-256-GCM, một
// hàng/user) + `user_backup_codes` (HMAC-SHA256 có pepper). Bảng riêng để Hub và snapshot audit `users` không chạm
// tới secret. RLS, policy `admin_rw`, `REVOKE ALL … FROM hub_ro` nằm ở phần nối tay cuối migration 0008_admin_totp.
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  customType,
  foreignKey,
  index,
  smallint,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { admin, tenants, users } from "./admin";

const tsz = (name: string) => timestamp(name, { withTimezone: true });
const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "bytea",
});

/** `enabled_at` NULL = đang setup (khi đó `pending_expires_at` bắt buộc); đã bật thì `pending_expires_at` NULL. */
export const userTotp = admin.table(
  "user_totp",
  {
    userId: uuid("user_id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    secretCt: bytea("secret_ct").notNull(),
    secretIv: bytea("secret_iv").notNull(),
    keyVersion: smallint("key_version").notNull().default(1),
    enabledAt: tsz("enabled_at"),
    pendingExpiresAt: tsz("pending_expires_at"),
    lastUsedStep: bigint("last_used_step", { mode: "bigint" }),
    createdAt: tsz("created_at").notNull().defaultNow(),
    updatedAt: tsz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("user_totp_tenant_user_uq").on(t.tenantId, t.userId),
    foreignKey({
      name: "user_totp_user_fk",
      columns: [t.tenantId, t.userId],
      foreignColumns: [users.tenantId, users.id],
    }).onDelete("cascade"),
    check("user_totp_secret_ct_len_check", sql`octet_length(${t.secretCt}) = 36`),
    check("user_totp_secret_iv_len_check", sql`octet_length(${t.secretIv}) = 12`),
    check("user_totp_key_version_check", sql`${t.keyVersion} >= 1`),
    check(
      "user_totp_pending_check",
      sql`(${t.enabledAt} IS NULL) = (${t.pendingExpiresAt} IS NOT NULL)`,
    ),
  ],
);

/** Mã dự phòng dùng một lần: `UPDATE … SET used_at = now() WHERE used_at IS NULL RETURNING`. */
export const userBackupCodes = admin.table(
  "user_backup_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    userId: uuid("user_id").notNull(),
    codeHash: bytea("code_hash").notNull(),
    usedAt: tsz("used_at"),
    createdAt: tsz("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("user_backup_codes_user_hash_uq").on(t.userId, t.codeHash),
    index("user_backup_codes_unused_idx").on(t.userId).where(sql`${t.usedAt} IS NULL`),
    foreignKey({
      name: "user_backup_codes_totp_fk",
      columns: [t.tenantId, t.userId],
      foreignColumns: [userTotp.tenantId, userTotp.userId],
    }).onDelete("cascade"),
    check("user_backup_codes_hash_len_check", sql`octet_length(${t.codeHash}) = 32`),
  ],
);
