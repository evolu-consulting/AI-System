// HUB-FR-131 · HUB-FR-132 · HUB-FR-133 · HUB-FR-134 · HUB-BR-40 · CR-073 · contract KnowledgeHub (spec K1 §3.1–3.2, plan §1).
// Kết nối KH là cấu hình NỀN TẢNG (Studio `/studio/api/kh/connections*`, chỉ platform_admin). Mọi object strict.
// Không bao giờ có giá trị khoá trong response — chỉ `secret {id, name}`. Lỗi = `ErrorResponse` M0.
import { z } from "zod";
import { IsoDateTime, UpdatedBySchema, UuidSchema } from "../common";

// ── Hằng (plan §1) ──
export const KH_TOOL_KEY = "kh-query";
export const KH_QUERY_LIMIT = 5;
export const KH_BUDGET_CHARS = 4000;
export const KH_QUERY_K = 8;
export const KH_QUERY_MAX_CHARS = 1500;
export const KH_AGENT_CONNECTIONS_MAX = 5;
export const KH_PROJECTS_MAX = 50;
export const KH_PROJECTS_CACHE_MS = 300_000;
export const KH_MIN_VERSION = [6, 4] as const;
export const KH_SUMMARY_SECTION = "Tóm tắt";
export const KH_SUMMARY_WORDS = 200;
export const KH_KEY_HEADER = "X-KH-Key";
export const KH_BASE_URL_MAX = 512;
export const KH_CONNECTION_NAME_MAX = 80;
export const KH_CHECK_ITEMS_MAX = 20;
export const KH_QUERY_TEXT_MAX = 4000;

// ── Kiểu chung (§3.1) ──
/** Q25: không `/` (nhãn `<tên kết nối>/<project>` dùng `/` làm dấu tách). */
export const KH_PROJECT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
export const KhProjectIdSchema = z.string().regex(KH_PROJECT_ID_RE);
export type KhProjectId = z.infer<typeof KhProjectIdSchema>;

export const KhConnectionNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(KH_CONNECTION_NAME_MAX)
  .regex(/^[^/]*$/, "name must not contain '/'");

export const KH_CHECK_ERROR_CODES = [
  "kh_url_not_allowed",
  "kh_unreachable",
  "kh_timeout",
  "kh_auth_disabled",
  "kh_key_invalid",
  "kh_key_rejected",
  "kh_version_too_old",
] as const;
export const KH_CHECK_WARNING_CODES = [
  "kh_auth_disabled_dev",
  "kh_embedder_english",
  "kh_projects_empty",
  "kh_projects_many",
  "kh_summary_project_missing",
] as const;
/** 7 lỗi + 5 cảnh báo (plan §3.1). */
export const KH_CHECK_CODES = {
  error: KH_CHECK_ERROR_CODES,
  warning: KH_CHECK_WARNING_CODES,
} as const;
export type KhCheckErrorCode = (typeof KH_CHECK_ERROR_CODES)[number];
export type KhCheckWarningCode = (typeof KH_CHECK_WARNING_CODES)[number];
export type KhCheckCode = KhCheckErrorCode | KhCheckWarningCode;
export const KhCheckCodeSchema = z.enum([...KH_CHECK_ERROR_CODES, ...KH_CHECK_WARNING_CODES]);
export const KH_CHECK_LEVELS = ["error", "warning"] as const;

const isErrorCode = (c: string): boolean => (KH_CHECK_ERROR_CODES as readonly string[]).includes(c);

/** `level` phải khớp nhóm của `code` (lỗi ⇔ `error`). */
export const KhCheckItemSchema = z
  .strictObject({
    code: KhCheckCodeSchema,
    level: z.enum(KH_CHECK_LEVELS),
    params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  })
  .refine((i) => (i.level === "error") === isErrorCode(i.code), {
    message: "level does not match code",
    path: ["level"],
  });
export type KhCheckItem = z.infer<typeof KhCheckItemSchema>;

export const KH_CHECK_STATUSES = ["ok", "error"] as const;
/** `status = "error"` ⇔ có ít nhất một mục `level = "error"`. */
export const KhCheckResultSchema = z
  .strictObject({
    status: z.enum(KH_CHECK_STATUSES),
    checked_at: IsoDateTime,
    kh_version: z.string().max(64).nullable(),
    embedder: z.string().max(200).nullable(),
    projects: z.array(KhProjectIdSchema).max(KH_PROJECTS_MAX),
    items: z.array(KhCheckItemSchema).max(KH_CHECK_ITEMS_MAX),
  })
  .refine((r) => (r.status === "error") === r.items.some((i) => i.level === "error"), {
    message: "status must be error iff an error item exists",
    path: ["status"],
  });
export type KhCheckResult = z.infer<typeof KhCheckResultSchema>;

/** Hạ cấp `kh-query` / ghi Tóm tắt (spec §3.1, `classifyKhFailure` + `disabled`). */
export const KH_WARNING_CODES = [
  "unreachable",
  "timeout",
  "unauthorized",
  "forbidden",
  "not_found",
  "invalid",
  "rate_limited",
  "server_error",
  "disabled",
] as const;
export const KhWarningCodeSchema = z.enum(KH_WARNING_CODES);
export type KhWarningCode = z.infer<typeof KhWarningCodeSchema>;

// ── Kết nối (§3.1–3.2) ──
export const KH_CONNECTION_STATUSES = ["unchecked", "ok", "error"] as const;
export const KhConnectionStatusSchema = z.enum(KH_CONNECTION_STATUSES);
export type KhConnectionStatus = z.infer<typeof KhConnectionStatusSchema>;

export const KhSecretRefSchema = z.strictObject({ id: UuidSchema, name: z.string() });

export const KhConnectionSchema = z.strictObject({
  id: UuidSchema,
  name: z.string(),
  base_url: z.string(),
  secret: KhSecretRefSchema,
  summary_project: KhProjectIdSchema.nullable(),
  status: KhConnectionStatusSchema,
  check: KhCheckResultSchema.nullable(),
  agents_count: z.number().int().min(0),
  version: z.number().int().min(1),
  updated_at: IsoDateTime,
  updated_by: UpdatedBySchema,
});
export type KhConnection = z.infer<typeof KhConnectionSchema>;

const writeShape = {
  name: KhConnectionNameSchema,
  /** Chuẩn hoá + allowlist ở server (`khUrlPolicy` ⇒ 422 `KH_URL_NOT_ALLOWED`). */
  base_url: z.string().trim().min(1).max(KH_BASE_URL_MAX),
  /** Phải `kind = kh_api_key` ∧ nền tảng (server ⇒ 422 `KH_SECRET_INVALID`). */
  secret_id: UuidSchema,
  summary_project: KhProjectIdSchema.nullable().default(null),
};
/** POST. */
export const KhConnectionWriteSchema = z.strictObject(writeShape);
export type KhConnectionWrite = z.infer<typeof KhConnectionWriteSchema>;
/** PUT `:id` — đổi `base_url`/`secret_id` ⇒ `unchecked`. */
export const KhConnectionUpdateSchema = z.strictObject({
  ...writeShape,
  version: z.number().int().min(1),
});
export type KhConnectionUpdate = z.infer<typeof KhConnectionUpdateSchema>;

export const KhConnectionListQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(512).optional(),
});
export type KhConnectionListQuery = z.infer<typeof KhConnectionListQuerySchema>;

/** Sắp `(lower(name), id)`; `allowed_origins`/`timeout_ms` = cấu hình env (G1) cho form. */
export const KhConnectionListResponseSchema = z.strictObject({
  items: z.array(KhConnectionSchema).max(100),
  next_cursor: z.string().nullable(),
  allowed_origins: z.array(z.string()),
  timeout_ms: z.number().int().min(1),
});
export type KhConnectionListResponse = z.infer<typeof KhConnectionListResponseSchema>;

export const KhConnectionDeleteQuerySchema = z.strictObject({
  version: z.coerce.number().int().min(1),
});

/** `PUT /studio/api/agents/:id/knowledge` — thứ tự = thứ tự tick; trùng/quá ⇒ 400 path `connection_ids`. */
export const AgentKnowledgeRequestSchema = z.strictObject({
  connection_ids: z
    .array(UuidSchema)
    .max(KH_AGENT_CONNECTIONS_MAX)
    .refine((a) => new Set(a).size === a.length, "duplicate ids"),
  version: z.number().int().min(1),
});
export type AgentKnowledgeRequest = z.infer<typeof AgentKnowledgeRequestSchema>;

// ── StageView.knowledge (§3.1) ──
export const KH_SUMMARY_STATES = ["none", "pending", "written", "failed", "skipped"] as const;
export const StageKnowledgeSchema = z.strictObject({
  write_to: z.strictObject({ connection: z.string(), project: KhProjectIdSchema }).nullable(),
  queries: z.number().int().min(0).max(KH_QUERY_LIMIT),
  query_limit: z.literal(KH_QUERY_LIMIT),
  warning: KhWarningCodeSchema.nullable(),
  summary: z.enum(KH_SUMMARY_STATES),
});
export type StageKnowledge = z.infer<typeof StageKnowledgeSchema>;

// ── Lỗi (§3.2, §3.3) ──
/** Mã riêng KH + HTTP. Dùng lại: VALIDATION_ERROR 400, FORBIDDEN 403, NOT_FOUND 404, VERSION_CONFLICT 409. */
export const HUB_KH_ERRORS = {
  KH_CONNECTION_EXISTS: 409,
  KH_CONNECTION_IN_USE: 409,
  KH_URL_NOT_ALLOWED: 422,
  KH_SECRET_INVALID: 422,
  KH_AGENT_RUNTIME: 422,
  KH_CONNECTION_NOT_FOUND: 422,
} as const satisfies Record<string, 409 | 422>;
export type HubKhErrorCode = keyof typeof HUB_KH_ERRORS;

export const KhConnectionExistsDetailsSchema = z.strictObject({
  id: UuidSchema,
  field: z.enum(["name", "base_url"]),
});
export const KH_URL_REJECT_REASONS = ["invalid", "not_https", "not_in_allowlist"] as const;
export const KhUrlNotAllowedDetailsSchema = z.strictObject({
  reason: z.enum(KH_URL_REJECT_REASONS),
});
export const KH_SECRET_INVALID_REASONS = ["not_found", "wrong_kind", "not_platform"] as const;
export const KhSecretInvalidDetailsSchema = z.strictObject({
  reason: z.enum(KH_SECRET_INVALID_REASONS),
});
/** `agents` = số agent đang tick kết nối (đếm `agent_kh`). */
export const KhConnectionInUseDetailsSchema = z.strictObject({
  agents: z.number().int().min(1),
});
export const KhConnectionNotFoundDetailsSchema = z.strictObject({
  ids: z.array(UuidSchema).min(1).max(KH_AGENT_CONNECTIONS_MAX),
});
/** `details` của 409 `VERSION_CONFLICT` (PUT/DELETE kết nối). */
export const KhConnectionConflictDetailsSchema = z.strictObject({
  current: KhConnectionSchema,
  updated_at: IsoDateTime,
});

/** Lỗi tool `kh-query` (`isError`, không lỗi run — §3.3). */
export const KH_TOOL_ERRORS = ["INVALID_ARGS", "KH_PROJECT", "KH_LIMIT", "KH_UNAVAILABLE"] as const;
export type KhToolErrorCode = (typeof KH_TOOL_ERRORS)[number];
