// V2-E · BA v2 §5.1 · DT-02/03/04 · CD-02..05 · HD-06 · CR-096 Q1: contract zod của uy tín v2 (`/pack/contracts/reputation/**`).
// Đối tác = `party` (khoá `tax:`/`name:`); ô = nhóm SP × vai. Thân strict (khoá lạ ⇒ 400); luật cấu hình sai ⇒ 422.
import { z } from "zod";
import { nfcText } from "./fields";
import { IsoDay } from "./ledger";

export const REP_GROUPS = ["service", "goods", "referral"] as const;
export const REP_ROLES = ["supplier", "customer", "commission_payer"] as const;
export const REP_LEVELS = ["good", "fair", "watch", "new"] as const;
export type RepLevel = (typeof REP_LEVELS)[number];

const keyText = (min: number, max: number) =>
  z
    .string()
    .min(min)
    .max(max)
    .refine((v) => !v.includes("\u0000"), { message: "NUL không được phép" });
const Party = keyText(1, 300);
const Key = z.string().regex(/^[a-z0-9_:-]{1,60}$/);
export const RepGroupSchema = z.enum(REP_GROUPS);
export const RepRoleSchema = z.enum(REP_ROLES);

export const RepPartnersQuerySchema = z.strictObject({
  role: z.enum(["all", ...REP_ROLES]).default("all"),
});
export const RepPartnerQuerySchema = z.strictObject({ party: Party, role: RepRoleSchema });
export const RepHistoryQuerySchema = z.strictObject({
  party: Party,
  role: RepRoleSchema,
  months: z.enum(["3", "6", "12"]).default("12"),
});

const Int = (lo: number, hi: number) => z.number().int().min(lo).max(hi);
export const RepCriterionInSchema = z.strictObject({
  key: Key.nullish(),
  label: nfcText(60),
  kind: z.enum(["ontime", "jobs", "bad_count", "manual"]),
  milestone: z.enum(["delivery", "payment", "serial", "commission"]).nullish(),
  penalty: Int(1, 100).nullish(),
  weight: Int(0, 100),
  enabled: z.boolean(),
});
export const RepCellConfigSchema = z.strictObject({
  criteria: z.array(RepCriterionInSchema).min(1).max(30),
  window_months: Int(1, 36),
  decay: z.strictObject({
    months: z.array(Int(1, 36)).max(3),
    factors: z.array(z.number().gt(0).max(1)).min(1).max(4),
  }),
  late_per_day: z.number().min(0).max(100),
});
export type RepCellConfigIn = z.infer<typeof RepCellConfigSchema>;
export const RepSettingsSchema = z.strictObject({
  good_from: Int(1, 100),
  fair_from: Int(0, 99),
  min_jobs: Int(0, 100),
  manual_share: Int(0, 50),
  reason_gap: Int(0, 100),
  lock_period: z.literal("month"),
});
export type RepSettingsIn = z.infer<typeof RepSettingsSchema>;
export const RepJobTypeSchema = z.strictObject({
  key: Key,
  name: nfcText(80).pipe(z.string().min(1)),
  criterion: Key,
  score: Int(0, 100),
});
export const RepJobTypesSchema = z.strictObject({ items: z.array(RepJobTypeSchema).max(50) });
export type RepJobTypesIn = z.infer<typeof RepJobTypesSchema>;

/** "Thử tính" (CD-02..05): bản nháp một ô / cài đặt chung / danh mục loại việc — không ghi gì. */
export const RepPreviewSchema = z.strictObject({
  cell: z
    .strictObject({ group: RepGroupSchema, role: RepRoleSchema, config: RepCellConfigSchema })
    .nullish(),
  settings: RepSettingsSchema.nullish(),
  job_types: z.array(RepJobTypeSchema).max(50).nullish(),
});
export type RepPreviewIn = z.infer<typeof RepPreviewSchema>;

/** DT-04: 1–5 sao một tiêu chí; lệch nhiều so với dữ liệu ⇒ bắt lý do (422 khi thiếu). */
export const RepRatingSchema = z.strictObject({
  party: Party,
  role: RepRoleSchema,
  group: RepGroupSchema,
  criterion: Key,
  stars: Int(1, 5),
  reason: nfcText(500).nullish(),
});
export type RepRatingIn = z.infer<typeof RepRatingSchema>;

/** HD-06: ghi việc phát sinh theo danh mục "Loại việc". */
export const RepJobSchema = z.strictObject({
  party: Party,
  role: RepRoleSchema,
  group: RepGroupSchema,
  job_type: Key,
  at: IsoDay.nullish(),
  note: nfcText(500).nullish(),
  contract_id: z.uuid().nullish(),
});
export type RepJobIn = z.infer<typeof RepJobSchema>;
