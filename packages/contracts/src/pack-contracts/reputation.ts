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
/** V2-GAPS · C10: "Uy tín của mình" — khoảng ngày nhìn lại (mặc định 90 như mockup). */
export const RepMineQuerySchema = z.strictObject({
  days: z.enum(["30", "90", "180", "365"]).default("90"),
});
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

// ---------- ra (V2-I: UI đọc) ----------
export type RepGroup = (typeof REP_GROUPS)[number];
export type RepRole = (typeof REP_ROLES)[number];
export type RepGroupOut = {
  group: RepGroup;
  score: number | null;
  data_score: number | null;
  stars: number | null;
  level: RepLevel;
  jobs: number;
  value: number;
};
/** `GET /reputation/partners`: một dòng mỗi đối tác × vai, kèm điểm từng nhóm. */
export type RepPartnerRow = {
  party: string;
  name: string;
  role: RepRole;
  score: number | null;
  level: RepLevel;
  jobs: number;
  groups: RepGroupOut[];
  /** REP-v3 · U2 (R39): cờ đỏ cấp đối tác (tách khỏi điểm) — có ở `GET /reputation/partners`. */
  red_flag?: boolean;
  red_flags?: { type: "no_delivery" | "fraud"; n: number }[];
};
/** REP-v3 · cờ `REPUTATION_ENGINE`: engine điểm hiện hành (`GET /reputation/config` trả `engine`). */
export type RepEngine = "v2e" | "hd8";
/** REP-v3 · TQ-04 (R71) `GET /reputation/attention`: CHÚ Ý, cờ đỏ, hoặc giảm ≥ 3 điểm so với kỳ chốt 3 tháng trước. */
export type RepAttentionRow = RepPartnerRow & {
  reasons: ("red_flag" | "watch" | "drop")[];
  before: number | null;
  drop: number | null;
};
/** REP-v3 `GET /reputation/switch-preview` (quản lý): mức HD8 hiện hành vs V2-E — "N đối tác đổi mức nếu bật". */
export type RepSwitchPreview = {
  engine: RepEngine;
  total: number;
  changed: number;
  partners: number;
  moves: { from: RepLevel; to: RepLevel; n: number }[];
  items: {
    party: string;
    name: string;
    role: RepRole;
    hd8: { score: number | null; level: RepLevel };
    v2e: { score: number | null; level: RepLevel };
  }[];
};
export type RepCriterionOut = {
  key: string;
  label: string;
  kind: "ontime" | "jobs" | "bad_count" | "manual";
  weight: number;
  score: number | null;
  n: number;
};
export type RepCellOut = RepGroupOut & { role: RepRole; criteria: RepCriterionOut[] };
/** DT-02: một việc góp điểm của một tiêu chí. */
export type RepDetailItem = {
  source: "milestone" | "job";
  id: string;
  group: RepGroup;
  criterion: string;
  at: string;
  score: number | null;
  h: number;
  label: string;
  late_days?: number;
  fault?: string | null;
  contract_id: string | null;
  contract?: string | null;
  note?: string | null;
};
export type RepDetail = {
  party: string;
  name: string;
  role: RepRole;
  score: number | null;
  level: RepLevel;
  jobs: number;
  groups: RepCellOut[];
  items: RepDetailItem[];
};
export type RepHistoryPoint = {
  period: string;
  score: number | null;
  level: RepLevel;
  jobs: number;
};
/** DT-03: điểm đã chốt các tháng + điểm hiện tại + hai ngưỡng để vẽ đường TỐT/KHÁ. */
export type RepHistory = {
  party: string;
  role: RepRole;
  months: number;
  thresholds: { good_from: number; fair_from: number };
  points: RepHistoryPoint[];
  current: { period: string; score: number | null; level: RepLevel; jobs: number } | null;
};
export type RepRatingRow = {
  id: string;
  group: RepGroup;
  criterion: string;
  stars: number;
  reason: string | null;
  by_user: string | null;
  by: string | null;
  at: string;
};
export type RepRatings = { current: RepRatingRow[]; history: RepRatingRow[] };
export type RepSettingsOut = {
  good_from: number;
  fair_from: number;
  min_jobs: number;
  manual_share: number;
  reason_gap: number;
  lock_period: "month";
};
export type RepConfigOut = { settings: RepSettingsOut };

/**
 * V2-GAPS · C10 (mockup "Uy tín của mình với khách"): mốc việc CỦA MÌNH đã xong trong `days` ngày qua — đúng hạn / trễ, trễ do ai
 * (`fault`), và đối tác bị ghi lỗi nhiều nhất. KHÔNG trừ điểm đối tác (BA: lỗi của mình chỉ ghi vào uy tín của mình).
 */
export type RepMine = {
  days: number;
  total: number;
  late: number;
  /** % mốc đúng hạn (null khi chưa có mốc nào). */
  on_time_pct: number | null;
  by_fault: { ours: number; partner: number; unknown: number };
  by_deal: { deal: "buy" | "sell" | "referral"; total: number; late: number }[];
  /** Đối tác bị ghi lỗi trong các lần mình trễ (nhiều nhất trước, ≤ 3). */
  blamed: { party: string; name: string; late: number }[];
};
