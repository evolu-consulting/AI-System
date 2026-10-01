// ADM-FR-32, ADM-FR-35, ADM-BR-12 · contract /admin/grants* (spec M3 §3 "Grants", M3-R07…R10).
import { z } from "zod";
import {
  CATALOG_KEY_RE,
  CountSchema,
  FEATURE_NAME_MAX,
  FeatureStatusSchema,
  IsoDateTime,
  LIST_OFFSET_MAX,
  ListQueryBase,
  LocalizedTextSchema,
  pageResponseSchema,
  UpdatedBySchema,
  USERNAME_RE,
  UuidSchema,
} from "./common";
import { GroupRefSchema, groupRefShape, refineBeta } from "./groups";

export const GRANT_BATCH_MAX = 200;
export const MATRIX_GROUPS_MAX = 200;
export const MATRIX_COMMAND_NAMES_MAX = 10;
export const MATRIX_ROW_STATES = ["core", "entitled", "revoked", "none"] as const;
export const MatrixRowStateSchema = z.enum(MATRIX_ROW_STATES);
export type MatrixRowState = z.infer<typeof MatrixRowStateSchema>;

export const GrantFeatureRefSchema = z.strictObject({
  id: UuidSchema,
  key: z.string().regex(CATALOG_KEY_RE),
  name: LocalizedTextSchema(FEATURE_NAME_MAX),
  status: FeatureStatusSchema,
  is_core: z.boolean(),
});
export type GrantFeatureRef = z.infer<typeof GrantFeatureRefSchema>;

export const GrantUserRefSchema = z.strictObject({
  id: UuidSchema,
  username: z.string().regex(USERNAME_RE),
  display_name: z.string().min(1),
});
export type GrantUserRef = z.infer<typeof GrantUserRefSchema>;

export const GrantSubjectSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("group"), group: GroupRefSchema }),
  z.strictObject({ type: z.literal("user"), user: GrantUserRefSchema }),
]);
export type GrantSubject = z.infer<typeof GrantSubjectSchema>;

/** `entitled` = entitlement chưa thu hồi **lúc đọc** (BR-12: grant giữ nguyên khi thu hồi). */
export const GrantSchema = z.strictObject({
  id: UuidSchema,
  tenant_id: UuidSchema,
  feature: GrantFeatureRefSchema,
  subject: GrantSubjectSchema,
  entitled: z.boolean(),
  granted_at: IsoDateTime,
  granted_by: UpdatedBySchema,
});
export type Grant = z.infer<typeof GrantSchema>;

/** `q` khớp key/tên feature; sắp feature.key, group trước user, rồi group.key/username. */
export const GrantListQuerySchema = ListQueryBase.extend({
  tenant_id: UuidSchema.optional(),
  feature_id: UuidSchema.optional(),
  group_id: UuidSchema.optional(),
  user_id: UuidSchema.optional(),
});
export type GrantListQuery = z.infer<typeof GrantListQuerySchema>;
export const GrantListResponseSchema = pageResponseSchema(GrantSchema);
export type GrantListResponse = z.infer<typeof GrantListResponseSchema>;

const exactlyOneSubject = (g: { group_id?: string; user_id?: string }) =>
  (g.group_id === undefined) !== (g.user_id === undefined);
const subjectIssue = { message: "exactly one of group_id, user_id is required", path: [] };

export const GrantCreateRequestSchema = z
  .strictObject({
    feature_id: UuidSchema,
    group_id: UuidSchema.optional(),
    user_id: UuidSchema.optional(),
  })
  .refine(exactlyOneSubject, subjectIssue);
export type GrantCreateRequest = z.infer<typeof GrantCreateRequestSchema>;

export const GrantDeleteQuerySchema = z
  .strictObject({
    tenant_id: UuidSchema.optional(),
    feature_id: UuidSchema,
    group_id: UuidSchema.optional(),
    user_id: UuidSchema.optional(),
  })
  .refine(exactlyOneSubject, subjectIssue);
export type GrantDeleteQuery = z.infer<typeof GrantDeleteQuerySchema>;

export const GrantKeySchema = z.strictObject({ feature_id: UuidSchema, group_id: UuidSchema });
export type GrantKey = z.infer<typeof GrantKeySchema>;

/** Một cặp xuất hiện hai lần (trong một mảng hoặc giữa `add` và `remove`) → issue tại phần tử lặp. */
function noDuplicatePairs(b: { add: GrantKey[]; remove: GrantKey[] }, ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  for (const side of ["add", "remove"] as const) {
    b[side].forEach((k, i) => {
      const id = `${k.feature_id}:${k.group_id}`;
      if (seen.has(id))
        ctx.addIssue({ code: "custom", message: "duplicate pair", path: [side, i] });
      seen.add(id);
    });
  }
}

/** Chỉ group (M3-R09); tổng 1–200 thao tác; một transaction, sai một phần tử → không ghi gì (M3-R08). */
export const GrantBatchRequestSchema = z
  .strictObject({
    add: z.array(GrantKeySchema).default([]),
    remove: z.array(GrantKeySchema).default([]),
  })
  .superRefine((b, ctx) => {
    const n = b.add.length + b.remove.length;
    if (n < 1 || n > GRANT_BATCH_MAX) {
      ctx.addIssue({ code: "custom", message: `1–${GRANT_BATCH_MAX} operations`, path: [] });
    }
    noDuplicatePairs(b, ctx);
  });
export type GrantBatchRequest = z.infer<typeof GrantBatchRequestSchema>;

/** `unchanged` = |add| + |remove| − added − removed (thêm cặp đã có + bớt cặp không có). */
export const GrantBatchResponseSchema = z.strictObject({
  added: CountSchema,
  removed: CountSchema,
  unchanged: CountSchema,
});
export type GrantBatchResponse = z.infer<typeof GrantBatchResponseSchema>;

/** `group_id` → đúng một cột (tab Feature của group); `q` lọc group theo key/tên. */
export const GrantMatrixQuerySchema = z.strictObject({
  tenant_id: UuidSchema.optional(),
  group_id: UuidSchema.optional(),
  q: ListQueryBase.shape.q,
  limit: z.coerce.number().int().min(1).max(MATRIX_GROUPS_MAX).default(MATRIX_GROUPS_MAX),
  offset: z.coerce.number().int().min(0).max(LIST_OFFSET_MAX).default(0),
});
export type GrantMatrixQuery = z.infer<typeof GrantMatrixQuerySchema>;

export const MatrixGroupSchema = refineBeta(
  z.strictObject({ ...groupRefShape, member_count: CountSchema }),
);
export type MatrixGroup = z.infer<typeof MatrixGroupSchema>;

export const MatrixFeatureSchema = z.strictObject({
  feature: GrantFeatureRefSchema,
  state: MatrixRowStateSchema,
  command_names: z.array(z.string().regex(CATALOG_KEY_RE)).max(MATRIX_COMMAND_NAMES_MAX),
  command_count: CountSchema,
  /** Group được cấp, trong số `groups` trả về; sắp tăng. */
  granted_group_ids: z.array(UuidSchema),
});
export type MatrixFeature = z.infer<typeof MatrixFeatureSchema>;

/** `groups` sắp beta đầu rồi key; `features` = mọi feature catalog, core đầu rồi key. */
export const GrantMatrixSchema = z.strictObject({
  tenant_id: UuidSchema,
  groups: z.array(MatrixGroupSchema).max(MATRIX_GROUPS_MAX),
  group_total: CountSchema,
  features: z.array(MatrixFeatureSchema),
});
export type GrantMatrix = z.infer<typeof GrantMatrixSchema>;
