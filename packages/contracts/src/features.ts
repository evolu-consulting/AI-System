// ADM-FR-30, ADM-FR-31, ADM-FR-33, ADM-FR-34, ADM-BR-10, ADM-BR-12 · contract /admin/features*
// và entitlement (spec M2 §3, M2-R19…R22, R24). `core` tự hiệu lực mọi tenant, không có hàng entitlement.
import { z } from "zod";
import {
  CATALOG_KEY_RE,
  CatalogKeySchema,
  COMMAND_DESC_MAX,
  CORE_FEATURE_KEY,
  CountSchema,
  FEATURE_COMMANDS_MAX,
  FEATURE_DESC_MAX,
  FEATURE_ICON_DEFAULT,
  FEATURE_ICON_RE,
  FEATURE_NAME_MAX,
  FeatureStatusSchema,
  IsoDateTime,
  ListQueryBase,
  LocalizedOptionalSchema,
  LocalizedTextSchema,
  listResponseSchema,
  pageResponseSchema,
  TenantKeySchema,
  UpdatedBySchema,
  UuidSchema,
  uniqueArray,
  VersionSchema,
} from "./common";

export const FeatureIconSchema = z.string().regex(FEATURE_ICON_RE);
const FeatureNameSchema = LocalizedTextSchema(FEATURE_NAME_MAX);
const FeatureDescSchema = LocalizedOptionalSchema(FEATURE_DESC_MAX);
const CommandIdsSchema = uniqueArray(UuidSchema, FEATURE_COMMANDS_MAX);

/** Feature gắn trên command (danh sách/chi tiết command). */
export const FeatureRefSchema = z.strictObject({
  id: UuidSchema,
  key: z.string().regex(CATALOG_KEY_RE),
  name: FeatureNameSchema,
  status: FeatureStatusSchema,
});
export type FeatureRef = z.infer<typeof FeatureRefSchema>;

const listItemShape = {
  id: UuidSchema,
  key: z.string().regex(CATALOG_KEY_RE),
  name: FeatureNameSchema,
  description: FeatureDescSchema,
  /** `icon` null trong DB → `"package"`. */
  icon: FeatureIconSchema,
  status: FeatureStatusSchema,
  is_core: z.boolean(),
  command_count: CountSchema,
  /** Entitlement chưa thu hồi; `core` = 0 (FE hiện "Mọi tenant" theo `is_core`). */
  tenant_count: CountSchema,
  version: VersionSchema,
  updated_at: IsoDateTime,
  updated_by: UpdatedBySchema,
};
const coreMatches = (f: { key: string; is_core: boolean }) =>
  f.is_core === (f.key === CORE_FEATURE_KEY);
const coreIssue = { message: "is_core must equal key = 'core'", path: ["is_core"] };

export const FeatureListItemSchema = z.strictObject(listItemShape).refine(coreMatches, coreIssue);
export type FeatureListItem = z.infer<typeof FeatureListItemSchema>;

export const FeatureCommandItemSchema = z.strictObject({
  id: UuidSchema,
  name: z.string().regex(CATALOG_KEY_RE),
  description: LocalizedTextSchema(COMMAND_DESC_MAX),
  enabled: z.boolean(),
  /** Số feature hiện có của command (gồm feature này) — FE cảnh báo mồ côi khi = 1. */
  feature_count: z.number().int().min(1),
});
export type FeatureCommandItem = z.infer<typeof FeatureCommandItemSchema>;

export const FeatureDetailSchema = z
  .strictObject({
    ...listItemShape,
    created_at: IsoDateTime,
    /** Sắp `name`. */
    commands: z.array(FeatureCommandItemSchema),
    /** Σ user active (`active && !locked_by_tenant`) của tenant được entitlement (`core`: mọi tenant). */
    affected_user_count: CountSchema,
  })
  .refine(coreMatches, coreIssue);
export type FeatureDetail = z.infer<typeof FeatureDetailSchema>;

export const FeatureCreateRequestSchema = z.strictObject({
  key: CatalogKeySchema,
  name: FeatureNameSchema,
  description: FeatureDescSchema.default({}),
  icon: FeatureIconSchema.default(FEATURE_ICON_DEFAULT),
  status: FeatureStatusSchema.default("on"),
  command_ids: CommandIdsSchema.default([]),
});
export type FeatureCreateRequest = z.infer<typeof FeatureCreateRequestSchema>;

/** `key` bất biến (không có → 400). `command_ids` = thay cả tập trong cùng transaction. */
export const FeatureUpdateRequestSchema = z.strictObject({
  version: VersionSchema,
  name: FeatureNameSchema.optional(),
  description: FeatureDescSchema.optional(),
  icon: FeatureIconSchema.optional(),
  status: FeatureStatusSchema.optional(),
  command_ids: CommandIdsSchema.optional(),
});
export type FeatureUpdateRequest = z.infer<typeof FeatureUpdateRequestSchema>;

/** `q` khớp `key`, `name.vi/en`; sắp `core` đầu rồi `key`. */
export const FeatureListQuerySchema = ListQueryBase.extend({
  status: FeatureStatusSchema.optional(),
});
export type FeatureListQuery = z.infer<typeof FeatureListQuerySchema>;

/** Tính trừ bộ lọc chip `status`. */
export const FeatureListCountsSchema = z.strictObject({
  all: CountSchema,
  on: CountSchema,
  beta: CountSchema,
  off: CountSchema,
});
export type FeatureListCounts = z.infer<typeof FeatureListCountsSchema>;

export const FeatureListResponseSchema = listResponseSchema(
  FeatureListItemSchema,
  FeatureListCountsSchema,
);
export type FeatureListResponse = z.infer<typeof FeatureListResponseSchema>;

/** Chỉ hàng chưa thu hồi; `granted_by` = username | null. Query `ListQueryBase` (`q` khớp key/tên tenant). */
export const EntitlementSchema = z.strictObject({
  tenant_id: UuidSchema,
  tenant_key: TenantKeySchema,
  tenant_name: z.string().min(1),
  tenant_active: z.boolean(),
  active_user_count: CountSchema,
  granted_at: IsoDateTime,
  granted_by: UpdatedBySchema,
});
export type Entitlement = z.infer<typeof EntitlementSchema>;

/** Sắp `tenant_key`; `core` → `{items: [], total: 0}`. */
export const EntitlementListResponseSchema = pageResponseSchema(EntitlementSchema);
export type EntitlementListResponse = z.infer<typeof EntitlementListResponseSchema>;
