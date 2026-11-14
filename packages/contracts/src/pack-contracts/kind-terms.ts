// CR-152 · «Nhượng quyền» + «Thỏa thuận hợp tác»: trường riêng của hai loại HĐ (cột `contracts.kind_terms`, một nguồn), kỳ doanh thu /
// đối soát (mốc `contracts.obligations` có `period_key`) và API đọc/ghi. Tiền = số nguyên đồng 0…10¹⁵; % tối đa 2 chữ số thập phân.
import { z } from "zod";
import { nfcText } from "./fields";
import { IsoDay, LedgerMoney } from "./ledger";
import { KIND_DEALS } from "./milestones";

export const KIND_TEXT_MAX = 2000;
/** Mỗi kỳ ≤ 2 mốc + phí ban đầu + nhắc gia hạn ≤ `MILESTONES_MAX` (200). */
export const KIND_PERIODS_MAX = 99;
/** HĐ không có ngày kết thúc ⇒ chỉ sinh chuỗi kỳ này (12 kỳ đầu). */
export const KIND_PERIODS_OPEN_ENDED = 12;
export const KindDealSchema = z.enum(KIND_DEALS);
export type KindDeal = z.infer<typeof KindDealSchema>;

const pct = z
  .number()
  .min(0)
  .max(100)
  .refine((v) => Math.round(v * 100) === Number((v * 100).toFixed(6)), "tối đa 2 chữ số thập phân");
const text = nfcText(KIND_TEXT_MAX);

// ---------- Nhượng quyền ----------
export const FRANCHISE_ROLES = ["franchisor", "franchisee"] as const;
export const FRANCHISE_ROLE_LABELS = {
  franchisor: "Bên nhượng quyền",
  franchisee: "Bên nhận quyền",
} as const;
export const FRANCHISE_FEE_BASES = ["revenue_pct", "fixed"] as const;
export const FRANCHISE_FEE_BASIS_LABELS = {
  revenue_pct: "% doanh thu",
  fixed: "Số tiền cố định",
} as const;
export const FRANCHISE_PERIODS = ["month", "quarter"] as const;

/** Mọi trường tuỳ chọn khi LƯU NHÁP (AI đọc thiếu); đủ điều kiện khi gửi duyệt/xác nhận: `kindTermsMissing`. */
export const FranchiseTermsSchema = z.strictObject({
  role: z.enum(FRANCHISE_ROLES).nullish(),
  brand: text.min(1).nullish(),
  territory: text.nullish(),
  exclusive: z.boolean().nullish(),
  initial_fee: LedgerMoney.nullish(),
  fee_basis: z.enum(FRANCHISE_FEE_BASES).nullish(),
  /** % doanh thu (khi `fee_basis = revenue_pct`). */
  fee_pct: pct.nullish(),
  /** Số tiền mỗi kỳ (khi `fee_basis = fixed`). */
  fee_fixed: LedgerMoney.nullish(),
  period: z.enum(FRANCHISE_PERIODS).nullish(),
  ad_fee_pct: pct.nullish(),
  deposit: LedgerMoney.nullish(),
  foreign_franchisor: z.boolean().nullish(),
  /** Chỉ khi `foreign_franchisor = true`. */
  moit_registered: z.boolean().nullish(),
  moit_registered_on: IsoDay.nullish(),
});
export type FranchiseTerms = z.infer<typeof FranchiseTermsSchema>;

// ---------- Thỏa thuận hợp tác ----------
export const COOPERATION_SPLIT_BASES = ["profit", "revenue", "none"] as const;
export const COOPERATION_SPLIT_LABELS = {
  profit: "% lợi nhuận",
  revenue: "% doanh thu",
  none: "Không chia tiền (ghi nhớ hợp tác)",
} as const;
export const COOPERATION_PERIODS = ["month", "quarter", "year"] as const;

export const CooperationTermsSchema = z.strictObject({
  scope: text.min(1).nullish(),
  our_contribution: text.nullish(),
  partner_contribution: text.nullish(),
  split_basis: z.enum(COOPERATION_SPLIT_BASES).nullish(),
  /** Phần của mình (%); phần đối tác = 100 − giá trị này. Chỉ khi có chia. */
  our_share_pct: pct.nullish(),
  settle_period: z.enum(COOPERATION_PERIODS).nullish(),
});
export type CooperationTerms = z.infer<typeof CooperationTermsSchema>;

export type KindTerms = FranchiseTerms | CooperationTerms;
export const KIND_TERMS_BY_DEAL = {
  franchise: FranchiseTermsSchema,
  cooperation: CooperationTermsSchema,
} as const;

/** Khoá AI có thể báo "chưa chắc" cho hai loại (dạng `terms.<khoá>`, nằm chung mảng `unsure` với khoá `fields`). */
export const KIND_TERM_UNSURE_KEYS = [
  ...Object.keys(FranchiseTermsSchema.shape),
  ...Object.keys(CooperationTermsSchema.shape),
].map((k) => `terms.${k}`) as [`terms.${string}`, ...`terms.${string}`[]];

/** Khoá còn thiếu để gửi duyệt / xác nhận / nhập tay (rỗng = đủ) — MỘT nguồn cho hub-api và zod nhập tay. */
export function kindTermsMissing(deal: KindDeal, t: Record<string, unknown>): string[] {
  const nul = (v: unknown) => v === undefined || v === null || v === "";
  const miss = (...keys: string[]) => keys.filter((k) => nul(t[k]));
  if (deal === "franchise") {
    const m = miss("role", "brand", "fee_basis", "period");
    if (t.fee_basis === "revenue_pct") m.push(...miss("fee_pct"));
    if (t.fee_basis === "fixed") m.push(...miss("fee_fixed"));
    if (t.foreign_franchisor === true) m.push(...miss("moit_registered"));
    return m;
  }
  const m = miss("scope", "split_basis");
  if (t.split_basis === "profit" || t.split_basis === "revenue")
    m.push(...miss("our_share_pct", "settle_period"));
  return m;
}

// ---------- API ----------
export const KIND_ERRORS = {
  /** HĐ không phải Nhượng quyền / Hợp tác (hoặc Hợp tác «không chia» khi ghi kỳ). */
  KIND_TERMS_NOT_APPLICABLE: 422,
  /** Chỉ sửa trường riêng khi HĐ còn nháp. */
  KIND_TERMS_LOCKED: 409,
  /** Gửi duyệt/xác nhận khi còn thiếu trường bắt buộc của loại (`details.missing`). */
  KIND_TERMS_INCOMPLETE: 422,
  /** Mốc thu/trả phí của kỳ đã xác nhận ⇒ không ghi lại doanh thu. */
  PERIOD_LOCKED: 409,
} as const;
export type KindErrorCode = keyof typeof KIND_ERRORS;

/** `YYYY-MM` (tháng) · `YYYY-Qn` (quý) · `YYYY` (năm). */
export const PeriodKeySchema = z.string().regex(/^\d{4}(-(0[1-9]|1[0-2]|Q[1-4]))?$/);

export const KindTermsPutSchema = z.strictObject({ terms: z.record(z.string(), z.unknown()) });
export type KindTermsPut = z.infer<typeof KindTermsPutSchema>;

export const PeriodMilestoneSchema = z.strictObject({
  id: z.uuid(),
  due_date: IsoDay,
  status: z.enum(["open", "done", "cancelled"]),
  amount: z.number().int().nullable(),
});
export const PeriodSchema = z.strictObject({
  key: PeriodKeySchema,
  /** «tháng 12/2026» · «quý 1/2027» · «năm 2027». */
  label: z.string(),
  period_start: IsoDay,
  period_end: IsoDay,
  /** Doanh thu (nhượng quyền, hợp tác % doanh thu) hoặc lợi nhuận chung (% lợi nhuận) đã ghi; null = chưa ghi. */
  figure: z.number().int().nullable(),
  figure_kind: z.enum(["revenue", "profit"]),
  /** Mốc «Báo cáo doanh thu» (nhượng quyền) / «Đối soát» (hợp tác). */
  report: PeriodMilestoneSchema.nullable(),
  /** Mốc thu/trả phí của kỳ (chỉ nhượng quyền). */
  fee: PeriodMilestoneSchema.nullable(),
  /** Hợp tác: phần mình / phần đối tác khi đã ghi (tổng đúng từng đồng). */
  our_share: z.number().int().nullable(),
  partner_share: z.number().int().nullable(),
});
export type Period = z.infer<typeof PeriodSchema>;

/** `GET /pack/contracts/contracts/:id/kind-terms`. */
export const KindTermsViewSchema = z.strictObject({
  deal: KindDealSchema,
  terms: z.record(z.string(), z.unknown()),
  /** Khoá còn thiếu để gửi duyệt/xác nhận (rỗng = đủ). */
  missing: z.array(z.string()),
  periods: z.array(PeriodSchema),
});
export type KindTermsView = z.infer<typeof KindTermsViewSchema>;

/** `PUT /pack/contracts/contracts/:id/periods/:key` — ghi doanh thu kỳ / lợi nhuận chung kỳ (đồng, ≥ 0). */
export const PeriodRecordSchema = z.strictObject({ figure: LedgerMoney });
export type PeriodRecord = z.infer<typeof PeriodRecordSchema>;
