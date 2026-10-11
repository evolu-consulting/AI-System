// HUB-FR-120 · ADM-FR-68 · PB-R01/02/05/06/19/21 · CR-060 · contract nguồn tham chiếu (plan §3.1). Mọi object strict.
// `*Public` ẩn `config.path`/`pin.path` cho non-platform_admin (C1); server strip khi dựng `SourceView`/`SourceCheckResult`.
import { z } from "zod";
import { ProcessKeySchema } from "../chat/processes";
import { IsoDateTime, UpdatedBySchema, UuidSchema } from "../common";

export const SOURCE_KEY_RE = /^[a-z0-9-]{2,32}$/;
export const SOURCE_DESC_MAX = 500;
export const SOURCE_PATH_MAX = 1024;
export const SOURCE_URL_MAX = 2048;
export const SOURCE_BRANCH_MAX = 255;
export const SOURCE_GLOB_MAX = 256;
export const STAGE_SOURCES_MAX = 5;
export const STAGE_ALLOWLIST_MAX = 20;
export const DEF_SOURCES_MAX = 20;
export const RESOLVE_ITEMS_MAX = 20;
export const RESOLVE_ALLOWLIST_MAX = 40;
export const SOURCE_SHA_RE = /^[0-9a-f]{40}$/;

export const SOURCE_KINDS = ["git_remote", "local_path", "library"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SourceKeySchema = z.string().regex(SOURCE_KEY_RE);
export const SourceKindSchema = z.enum(SOURCE_KINDS);

/** Glob tương đối gốc nguồn: không `..`, không mở đầu `/`, không ký tự null (PB-R06). `picomatch` ở Runtime. */
export const GlobSchema = z
  .string()
  .min(1)
  .max(SOURCE_GLOB_MAX)
  .superRefine((v, ctx) => {
    if (v.includes("\0")) ctx.addIssue({ code: "custom", message: "null byte" });
    if (v.startsWith("/")) ctx.addIssue({ code: "custom", message: "absolute path" });
    if (v.split("/").includes("..")) ctx.addIssue({ code: "custom", message: "parent segment" });
  });

/** URL git công khai: `https://`, không userinfo (`user:pass@`/`tok@`) — PB-R02/R19. Host allowlist kiểm ở service. */
export const GitUrlSchema = z
  .string()
  .max(SOURCE_URL_MAX)
  .superRefine((v, ctx) => {
    let u: URL;
    try {
      u = new URL(v);
    } catch {
      ctx.addIssue({ code: "custom", message: "invalid url" });
      return;
    }
    if (u.protocol !== "https:") ctx.addIssue({ code: "custom", message: "not https" });
    if (u.username !== "" || u.password !== "")
      ctx.addIssue({ code: "custom", message: "url credential" });
  });

/** Branch không mở đầu `-` (chống inject đối số git, PB-R19). */
export const BranchSchema = z.string().min(1).max(SOURCE_BRANCH_MAX).regex(/^[^-]/);

export const PathSchema = z
  .string()
  .min(1)
  .max(SOURCE_PATH_MAX)
  .refine((v) => !v.includes("\0"), { message: "null byte" });

// ---------- config ----------
export const GitRemoteConfigSchema = z.strictObject({
  kind: z.literal("git_remote"),
  url: GitUrlSchema,
  branch: BranchSchema,
});
export const LocalPathConfigSchema = z.strictObject({
  kind: z.literal("local_path"),
  path: PathSchema,
});
export const LibraryConfigSchema = z.strictObject({
  kind: z.literal("library"),
  document_id: UuidSchema,
});
export const SourceConfigSchema = z.discriminatedUnion("kind", [
  GitRemoteConfigSchema,
  LocalPathConfigSchema,
  LibraryConfigSchema,
]);
export type SourceConfig = z.infer<typeof SourceConfigSchema>;

/** C1: ẩn `path` cho non-platform_admin. */
export const LocalPathConfigPublicSchema = z.strictObject({ kind: z.literal("local_path") });
export const SourceConfigPublicSchema = z.discriminatedUnion("kind", [
  GitRemoteConfigSchema,
  LocalPathConfigPublicSchema,
  LibraryConfigSchema,
]);
export type SourceConfigPublic = z.infer<typeof SourceConfigPublicSchema>;

// ---------- pin (ghim, D4) ----------
export const GitPinSchema = z.strictObject({
  kind: z.literal("git_remote"),
  url: GitUrlSchema,
  sha: z.string().regex(SOURCE_SHA_RE),
});
export const LocalPinSchema = z.strictObject({
  kind: z.literal("local_path"),
  path: z.string().max(SOURCE_PATH_MAX),
  snapshot_id: UuidSchema,
});
export const LibraryPinSchema = z.strictObject({
  kind: z.literal("library"),
  document_id: UuidSchema,
  version: UuidSchema,
});
export const SourcePinSchema = z.discriminatedUnion("kind", [
  GitPinSchema,
  LocalPinSchema,
  LibraryPinSchema,
]);
export type SourcePin = z.infer<typeof SourcePinSchema>;

/** C1: pin git/library không bí mật; local_path bỏ `path`. */
export const LocalPinPublicSchema = z.strictObject({
  kind: z.literal("local_path"),
  snapshot_id: UuidSchema,
});
export const SourcePinPublicSchema = z.discriminatedUnion("kind", [
  GitPinSchema,
  LocalPinPublicSchema,
  LibraryPinSchema,
]);
export type SourcePinPublic = z.infer<typeof SourcePinPublicSchema>;

// ---------- view + request ----------
const DescriptionSchema = z.string().max(SOURCE_DESC_MAX);

export const SourceViewSchema = z.strictObject({
  id: UuidSchema,
  tenant_id: UuidSchema,
  key: SourceKeySchema,
  kind: SourceKindSchema,
  config: z.union([SourceConfigSchema, SourceConfigPublicSchema]),
  description: DescriptionSchema,
  version: z.number().int().min(1),
  used_by: z.array(ProcessKeySchema),
  last_pin: z.union([SourcePinSchema, SourcePinPublicSchema]).nullable(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
  updated_by: UpdatedBySchema,
});
export type SourceView = z.infer<typeof SourceViewSchema>;

export const SourceCreateRequestSchema = z.strictObject({
  key: SourceKeySchema,
  kind: SourceKindSchema,
  config: SourceConfigSchema,
  description: DescriptionSchema,
  tenant_id: UuidSchema.optional(),
});
export type SourceCreateRequest = z.infer<typeof SourceCreateRequestSchema>;

export const SourceUpdateRequestSchema = z.strictObject({
  config: SourceConfigSchema,
  description: DescriptionSchema,
  version: z.number().int().min(1),
});
export type SourceUpdateRequest = z.infer<typeof SourceUpdateRequestSchema>;

export const SourceListQuerySchema = z.strictObject({
  tenant_id: UuidSchema.optional(),
  kind: SourceKindSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(512).optional(),
});
export type SourceListQuery = z.infer<typeof SourceListQuerySchema>;

export const SourceTenantQuerySchema = z.strictObject({ tenant_id: UuidSchema.optional() });
export const SourceDeleteQuerySchema = z.strictObject({
  tenant_id: UuidSchema.optional(),
  version: z.coerce.number().int().min(1),
});
export type SourceDeleteQuery = z.infer<typeof SourceDeleteQuerySchema>;

export const SourceCheckResultSchema = z.strictObject({
  pin: z.union([SourcePinSchema, SourcePinPublicSchema]),
  files: z.number().int().min(0),
  bytes: z.number().int().min(0),
});
export type SourceCheckResult = z.infer<typeof SourceCheckResultSchema>;

export const SourceInUseRefSchema = z.strictObject({
  process_key: ProcessKeySchema,
  stage_key: z.string().min(1),
});
export const SourceInUseDetailsSchema = z.strictObject({
  refs: z.array(SourceInUseRefSchema).max(100),
});
export type SourceInUseDetails = z.infer<typeof SourceInUseDetailsSchema>;

// ---------- library picker (C3) ----------
export const LibraryDocItemSchema = z.strictObject({
  id: UuidSchema,
  name: z.string(),
  version: UuidSchema,
  updated_at: IsoDateTime,
});
export const LibraryDocListQuerySchema = z.strictObject({
  tenant_id: UuidSchema.optional(),
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(512).optional(),
});
export const LibraryDocListResponseSchema = z.strictObject({
  items: z.array(LibraryDocItemSchema).max(100),
  next_cursor: z.string().nullable(),
});
export type LibraryDocListResponse = z.infer<typeof LibraryDocListResponseSchema>;

export const SourceListResponseSchema = z.strictObject({
  items: z.array(SourceViewSchema).max(100),
  next_cursor: z.string().nullable(),
});
export type SourceListResponse = z.infer<typeof SourceListResponseSchema>;

/** HUB-FR-120 · mã lỗi nguồn + HTTP. `VERSION_CONFLICT` dùng mã chung sẵn có. */
export const SOURCE_ERRORS = {
  SOURCE_KEY_TAKEN: 409,
  SOURCE_HOST_NOT_ALLOWED: 422,
  SOURCE_UNRESOLVABLE: 422,
  SOURCE_IN_USE: 409,
  SOURCE_FORBIDDEN_KIND: 403,
  SOURCE_TOO_LARGE: 422,
  SOURCE_NOT_FOUND: 404,
} as const satisfies Record<string, 403 | 404 | 409 | 422>;
export type SourceErrorCode = keyof typeof SOURCE_ERRORS;
