// HUB-FR-68 · HUB-FR-69 · HUB-BR-30 · kiểu Drizzle cho `hub.secrets` (spec H4b-1 §4, plan D6–D7).
// CHỈ để truy vấn có kiểu: DDL thật, CHECK, unique `lower(name)`, RLS, GRANT theo cột và hàm SECURITY DEFINER
// `hub.secret_material` ở `migrations-hub/0028_h4b1_secrets.sql` (viết tay).
// BẪY: `hub_rw` KHÔNG có SELECT trên `ciphertext`/`iv` ⇒ KHÔNG `db.select().from(hubSecrets)` và KHÔNG `returning()` rỗng
// (select * ⇒ 42501). Luôn chọn `SECRET_META_COLS`; đọc bản mã chỉ qua `hub.secret_material(id, kind, tenant)`.
import { HUB_SECRET_KINDS } from "@ai/contracts/hub-admin";
import { customType, integer, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { hub } from "./hub-readonly";

const ts = (name: string) => timestamp(name, { withTimezone: true });
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/** Một nguồn với contract; đổi giá trị ⇒ migration mới sửa `secrets_kind_ck`. */
export const HUB_SECRET_KIND_VALUES = HUB_SECRET_KINDS;
/** Trải vào `HUB_AUDIT_*_VALUES` (`hub.ts`) — khớp CHECK audit ở 0028. */
export const SECRET_AUDIT_ACTIONS = ["rotate"] as const;
export const SECRET_AUDIT_ENTITIES = ["secret"] as const;

export const hubSecrets = hub.table("secrets", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind", { enum: HUB_SECRET_KIND_VALUES }).notNull(),
  tenantId: uuid("tenant_id"),
  name: text("name").notNull(),
  /** Không SELECT được bằng `hub_rw` — chỉ INSERT/UPDATE. */
  ciphertext: bytea("ciphertext").notNull(),
  /** Không SELECT được bằng `hub_rw` — chỉ INSERT/UPDATE. */
  iv: bytea("iv").notNull(),
  keyVersion: smallint("key_version").notNull().default(1),
  version: integer("version").notNull().default(1),
  createdBy: uuid("created_by"),
  updatedBy: uuid("updated_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Cột `hub_rw` được SELECT — dùng cho mọi `select(...)`/`returning(...)`. */
export const SECRET_META_COLS = {
  id: hubSecrets.id,
  kind: hubSecrets.kind,
  tenantId: hubSecrets.tenantId,
  name: hubSecrets.name,
  keyVersion: hubSecrets.keyVersion,
  version: hubSecrets.version,
  createdBy: hubSecrets.createdBy,
  updatedBy: hubSecrets.updatedBy,
  createdAt: hubSecrets.createdAt,
  updatedAt: hubSecrets.updatedAt,
} as const;
export type HubSecretRow = {
  id: string;
  kind: (typeof HUB_SECRET_KIND_VALUES)[number];
  tenantId: string | null;
  name: string;
  keyVersion: number;
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};
