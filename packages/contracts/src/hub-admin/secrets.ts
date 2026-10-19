// HUB-FR-68 · HUB-FR-69 · HUB-BR-15 · HUB-BR-30 · contract secrets của Hub (spec H4b-1 §3, plan §1). Mọi object strict.
// CHỈ GHI: response không bao giờ có `value`/`ciphertext`/`iv`/`key_version`/`last4` (Q11). `value` chỉ có ở request.
// A: Studio `/studio/api/secrets*` (platform_admin, mọi kind). B: tenant `/admin/source-credentials*` (chỉ `source_credential`).
import { z } from "zod";
import { IsoDateTime, UpdatedBySchema, UuidSchema } from "../common";
import { SecretValueSchema } from "../secrets";

// N3-FR-08: `smtp_password` / `vapid_private_key` = secret nền tảng của cổng thông báo (tenant_id NULL), chỉ Studio tạo.
export const HUB_SECRET_KINDS = [
  "provider_api_key",
  "kh_api_key",
  "source_credential",
  "smtp_password",
  "vapid_private_key",
] as const;
export type HubSecretKind = (typeof HUB_SECRET_KINDS)[number];
export const HubSecretKindSchema = z.enum(HUB_SECRET_KINDS);

/** Q4: chữ hoa/thường được, duy nhất không phân biệt hoa-thường theo (kind, tenant_id) — kiểm ở DB (`secrets_name_uq`). */
export const HUB_SECRET_NAME_RE = /^[A-Za-z0-9_-]{2,64}$/;
export const HubSecretNameSchema = z.string().trim().regex(HUB_SECRET_NAME_RE);
/** = `SecretValueSchema` Admin: 8–2048 đơn vị UTF-16, không trim. Chuỗi mờ đục (có thể JSON nhỏ, Q7). */
export const HubSecretValueSchema = SecretValueSchema;

const Version = z.number().int().min(1);
const QueryVersion = z.coerce.number().int().min(1);
const Cursor = z.string().min(1).max(512);
const Q = z.string().max(64);

export const SECRET_USED_BY_TYPES = ["provider", "source", "knowledge_hub"] as const;
export const SecretUsedBySchema = z.strictObject({
  type: z.enum(SECRET_USED_BY_TYPES),
  id: UuidSchema,
  key: z.string().min(1).max(64),
});
export type SecretUsedBy = z.infer<typeof SecretUsedBySchema>;

export const SecretTenantRefSchema = z.strictObject({
  id: UuidSchema,
  key: z.string(),
  name: z.string(),
});
export type SecretTenantRef = z.infer<typeof SecretTenantRefSchema>;

/** Metadata — `used_by` sắp theo (type, key); `tenant` null = nền tảng. */
export const HubSecretSchema = z.strictObject({
  id: UuidSchema,
  kind: HubSecretKindSchema,
  tenant: SecretTenantRefSchema.nullable(),
  name: z.string(),
  version: Version,
  used_by: z.array(SecretUsedBySchema),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
  updated_by: UpdatedBySchema,
});
export type HubSecret = z.infer<typeof HubSecretSchema>;

export const HubSecretListResponseSchema = z.strictObject({
  items: z.array(HubSecretSchema).max(100),
  next_cursor: z.string().nullable(),
});
export type HubSecretListResponse = z.infer<typeof HubSecretListResponseSchema>;

// ── A. Studio ──
/** `tenant_id` vắng ⇒ mọi secret (nền tảng + mọi tenant); có ⇒ chỉ secret của tenant đó. */
export const HubSecretListQuerySchema = z.strictObject({
  kind: HubSecretKindSchema.optional(),
  tenant_id: UuidSchema.optional(),
  q: Q.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
  cursor: Cursor.optional(),
});
export type HubSecretListQuery = z.infer<typeof HubSecretListQuerySchema>;

/** Phạm vi theo kind (`secretScopeOk`) kiểm ở service ⇒ 400 path `tenant_id`. */
export const HubSecretCreateRequestSchema = z.strictObject({
  kind: HubSecretKindSchema,
  name: HubSecretNameSchema,
  value: HubSecretValueSchema,
  tenant_id: UuidSchema.optional(),
});
export type HubSecretCreateRequest = z.infer<typeof HubSecretCreateRequestSchema>;

/** Thay giá trị (IV mới, cùng AAD). `kind`/`tenant_id`/`name` bất biến. */
export const HubSecretRotateRequestSchema = z.strictObject({
  version: Version,
  value: HubSecretValueSchema,
});
export type HubSecretRotateRequest = z.infer<typeof HubSecretRotateRequestSchema>;

export const HubSecretDeleteQuerySchema = z.strictObject({ version: QueryVersion });
export type HubSecretDeleteQuery = z.infer<typeof HubSecretDeleteQuerySchema>;

// ── B. Tenant `/admin/source-credentials*` (kind cố định `source_credential`, body không có `kind`) ──
export const SourceCredentialListQuerySchema = z.strictObject({
  tenant_id: UuidSchema.optional(),
  q: Q.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: Cursor.optional(),
});
export type SourceCredentialListQuery = z.infer<typeof SourceCredentialListQuerySchema>;

export const SourceCredentialCreateRequestSchema = z.strictObject({
  name: HubSecretNameSchema,
  value: HubSecretValueSchema,
  tenant_id: UuidSchema.optional(),
});
export type SourceCredentialCreateRequest = z.infer<typeof SourceCredentialCreateRequestSchema>;

/** `?tenant_id=` của GET/PUT `:id` (platform_admin bắt buộc; tenant_admin = tenant phiên). */
export const SourceCredentialTenantQuerySchema = z.strictObject({
  tenant_id: UuidSchema.optional(),
});
export const SourceCredentialDeleteQuerySchema = z.strictObject({
  tenant_id: UuidSchema.optional(),
  version: QueryVersion,
});
export type SourceCredentialDeleteQuery = z.infer<typeof SourceCredentialDeleteQuerySchema>;

// ── Lỗi ──
/** Mã riêng secrets + HTTP. Dùng lại mã chung: NOT_FOUND 404, VERSION_CONFLICT 409, VALIDATION_ERROR 400, FORBIDDEN 403, NOT_CONFIGURED 409. */
export const HUB_SECRET_ERRORS = {
  SECRET_NAME_TAKEN: 409,
  SECRET_IN_USE: 409,
} as const satisfies Record<string, 409>;
export type HubSecretErrorCode = keyof typeof HUB_SECRET_ERRORS;

export const SecretInUseDetailsSchema = z.strictObject({
  used_by: z.array(SecretUsedBySchema).min(1),
});
export type SecretInUseDetails = z.infer<typeof SecretInUseDetailsSchema>;

/** `details` của 409 `VERSION_CONFLICT` (PUT/DELETE). */
export const HubSecretConflictDetailsSchema = z.strictObject({
  current: HubSecretSchema,
  updated_at: IsoDateTime,
});
export type HubSecretConflictDetails = z.infer<typeof HubSecretConflictDetailsSchema>;
