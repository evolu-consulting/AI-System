// CR-152 · Lớp 1 (không I/O): trường riêng của «Nhượng quyền» / «Thỏa thuận hợp tác» — chuẩn hoá, thiếu gì thì chưa gửi duyệt được,
// hướng tiền theo vai, và «có tính vào doanh thu / điểm / business không» (Hợp tác «không chia tiền» thì không, như HĐ nguyên tắc).
import {
  CooperationTermsSchema,
  FranchiseTermsSchema,
  kindTermsMissing,
} from "@ai/contracts/pack-contracts";

export type KindDealKey = "franchise" | "cooperation";
export type Terms = Record<string, unknown>;
export const isKindDeal = (d: unknown): d is KindDealKey =>
  d === "franchise" || d === "cooperation";

const SCHEMA = { franchise: FranchiseTermsSchema, cooperation: CooperationTermsSchema } as const;
const nul = (v: unknown): boolean => v === undefined || v === null || v === "";

type Field = { safeParse: (v: unknown) => { success: boolean; data?: unknown } };

/** Gỡ khoá lạ/sai kiểu (AI trích) — giữ từng khoá hợp lệ; deal không phải hai loại mới ⇒ null. */
export function sanitizeKindTerms(deal: unknown, raw: unknown): Terms | null {
  if (!isKindDeal(deal) || typeof raw !== "object" || raw === null) return null;
  const shape = SCHEMA[deal].shape as unknown as Record<string, Field>;
  const out: Terms = {};
  for (const [k, v] of Object.entries(raw as Terms)) {
    const f = Object.hasOwn(shape, k) ? shape[k] : undefined;
    if (!f || nul(v)) continue;
    const r = f.safeParse(v);
    if (r.success && !nul(r.data)) out[k] = r.data;
  }
  return normalizeKindTerms(deal, out);
}

/** Bỏ trường mâu thuẫn với lựa chọn chính (một nguồn): theo % ⇒ không số cố định; không phải nước ngoài ⇒ không đăng ký BCT; không chia ⇒ không phần/kỳ. */
export function normalizeKindTerms(deal: KindDealKey, t: Terms): Terms {
  const o: Terms = { ...t };
  if (deal === "franchise") {
    if (o.fee_basis === "revenue_pct") delete o.fee_fixed;
    if (o.fee_basis === "fixed") delete o.fee_pct;
    if (o.foreign_franchisor !== true) {
      delete o.moit_registered;
      delete o.moit_registered_on;
    }
  } else if (o.split_basis === "none") {
    delete o.our_share_pct;
    delete o.settle_period;
  }
  return o;
}

/** Khoá còn thiếu để gửi duyệt / xác nhận (rỗng = đủ) — một nguồn ở `@ai/contracts` (zod nhập tay dùng chung). */
export { kindTermsMissing };

/** Hướng tiền của HĐ (cột `direction`): bên nhượng quyền thu phí (`sale`), bên nhận quyền trả (`purchase`); Hợp tác: `sale`. */
export function directionOfKind(deal: KindDealKey, t: Terms): "sale" | "purchase" {
  return deal === "franchise" && t.role === "franchisee" ? "purchase" : "sale";
}

/** Hợp tác «không chia tiền» ⇒ không doanh thu / business / điểm uy tín (cùng điều kiện SQL ở `kind-filter.sql.ts`). */
export function countsMoney(deal: string | null, t: Terms | null): boolean {
  return !(deal === "cooperation" && t?.split_basis === "none");
}
