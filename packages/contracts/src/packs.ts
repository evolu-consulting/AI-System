// PK-FR-01 · PK-FR-05 · PK-FR-07 · PK-FR-08 · N1 plan §2: contract khung gói nghiệp vụ (khoá gói, mã quyền, vai, mã lỗi,
// schema Admin/Hub). Khoá gói khai MỘT chỗ ở đây; `packs.install` (migrations-packs/0001_kit.sql) kiểm cùng luật.
import { z } from "zod";

/** Khoá gói = tên schema Postgres + tiền tố role `<k>_rw`: 2–21 ký tự (D-05). */
export const PACK_KEY_RE = /^[a-z][a-z0-9_]{1,20}$/;
/** Tên schema có sẵn — cấm dùng làm khoá gói (cùng tiền tố `pg_`). */
export const RESERVED_PACK_KEYS = [
  "public",
  "admin",
  "hub",
  "drizzle",
  "packs",
  "notify",
  "information_schema",
] as const;

const isReserved = (k: string): boolean =>
  k.startsWith("pg_") || (RESERVED_PACK_KEYS as readonly string[]).includes(k);

export const PackKeySchema = z
  .string()
  .regex(PACK_KEY_RE)
  .refine((k) => !isReserved(k), { message: "khoá gói bị cấm" });
export type PackKey = z.infer<typeof PackKeySchema>;

export const PACK_ACTIONS = ["read", "write", "admin"] as const;
export const PackActionSchema = z.enum(PACK_ACTIONS);
export type PackAction = z.infer<typeof PackActionSchema>;

export const PACK_ROLES = ["owner", "editor", "viewer"] as const;
export const PackRoleSchema = z.enum(PACK_ROLES);
export type PackRole = z.infer<typeof PackRoleSchema>;

/** Vai → việc (D-05): viewer đọc · editor đọc+ghi · owner cả ba. */
export const PACK_ROLE_ACTIONS = {
  viewer: ["read"],
  editor: ["read", "write"],
  owner: ["read", "write", "admin"],
} as const satisfies Record<PackRole, readonly PackAction[]>;

const dash = (k: string): string => k.replaceAll("_", "-");
/** Mã hiển thị: `contracts.read`. */
export const packCode = (k: string, a: string): string => `${k}.${a}`;
/** Khoá `admin.features` (CHECK `^[a-z0-9-]{2,32}$` cấm `.`): `contracts-read`. Đơn ánh vì khoá gói không có `-`. */
export const packFeatureKey = (k: string, a: string): string => `${dash(k)}-${a}`;
/** Khoá `admin.groups` của vai: `contracts-owner`. */
export const packGroupKey = (k: string, r: string): string => `${dash(k)}-${r}`;

export const PackErrorCode = z.enum([
  "PACK_DISABLED",
  "PACK_FORBIDDEN",
  "PACK_NOT_FOUND",
  "DOCX_UNREADABLE",
  "DOCX_BUSY",
]);
export type PackErrorCode = z.infer<typeof PackErrorCode>;

export const PackStateSchema = z.object({
  key: PackKeySchema,
  enabled: z.boolean(),
  groups: z.array(z.object({ role: PackRoleSchema, group_id: z.uuid() })).max(3),
});
export type PackState = z.infer<typeof PackStateSchema>;

export const PackListResponseSchema = z.object({ items: z.array(PackStateSchema).max(50) });
export type PackListResponse = z.infer<typeof PackListResponseSchema>;

/** `GET /pack/<k>/me` — hợp lệ cả khi chưa bật/không quyền (`enabled:false`, `actions:[]`). */
export const PackMeResponseSchema = z.object({
  pack: PackKeySchema,
  enabled: z.boolean(),
  actions: z.array(PackActionSchema).max(3),
});
export type PackMeResponse = z.infer<typeof PackMeResponseSchema>;

export const IndexOutboxRowSchema = z.object({
  entity: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
  entity_id: z.uuid(),
  op: z.enum(["upsert", "delete"]),
});
export type IndexOutboxRow = z.infer<typeof IndexOutboxRowSchema>;

export const DocxMarkdownSchema = z.object({
  markdown: z.string().max(5_000_000),
  warnings: z.array(z.string().max(200)).max(50),
});
export type DocxMarkdown = z.infer<typeof DocxMarkdownSchema>;
