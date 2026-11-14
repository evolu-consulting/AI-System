// CR-152 · API trường riêng + kỳ doanh thu / đối soát của Nhượng quyền / Hợp tác. Lớp 2 — không SQL. MỘT tx `PackUow` (RLS tenant + quyền
// xem HĐ như sửa mốc): khoá HĐ → luật thuần → ghi (số câu cố định, không phụ thuộc số kỳ).
import type { KindTermsView, Period } from "@ai/contracts/pack-contracts";
import type { PackUow, PackWho } from "../../kit/public";
import { buildPeriods, franchiseFee, type PeriodRow } from "../domain/kind-schedule.rules";
import {
  directionOfKind,
  isKindDeal,
  kindTermsMissing,
  normalizeKindTerms,
  type Terms,
} from "../domain/kind-terms.rules";

export type KindContract = {
  deal: string | null;
  status: string;
  terms: Terms;
  start: string | null;
  end: string | null;
};
export type KindTermsRepo = {
  /** Khoá HĐ (for no key update); null = không thấy (RLS / tenant khác / không có). */
  lock(id: string): Promise<KindContract | null>;
  /** Ghi `kind_terms` + `direction` theo vai (chỉ HĐ nháp). */
  saveTerms(
    id: string,
    terms: Terms,
    direction: "sale" | "purchase",
    userId: string,
  ): Promise<void>;
  /** Mọi mốc có `period_key` còn hiệu lực của HĐ — MỘT câu. */
  periodRows(id: string): Promise<PeriodRow[]>;
  /** Ghi số kỳ lên mốc báo cáo/đối soát (xong), số phí lên mốc thu/trả còn mở + event — MỘT câu; trả số mốc báo cáo/đối soát đã ghi. */
  recordPeriod(
    id: string,
    key: string,
    w: { figure: number; fee: number | null },
    userId: string,
  ): Promise<number>;
};
export type KindTermsRepos = { kindTerms: KindTermsRepo };

export type KindFailCode =
  | "NOT_FOUND"
  | "KIND_TERMS_NOT_APPLICABLE"
  | "KIND_TERMS_LOCKED"
  | "PERIOD_LOCKED";
export class KindFail extends Error {
  constructor(readonly code: KindFailCode) {
    super(code);
  }
}

function view(c: KindContract, rows: PeriodRow[]): KindTermsView {
  const deal = c.deal as "franchise" | "cooperation";
  return {
    deal,
    terms: c.terms,
    missing: kindTermsMissing(deal, c.terms),
    periods: buildPeriods({ deal, terms: c.terms, start: c.start, end: c.end }, rows),
  };
}

export function kindTermsUsecases(d: { uow: PackUow<KindTermsRepos> }) {
  const need = async (r: KindTermsRepos, id: string) => {
    const c = await r.kindTerms.lock(id);
    if (!c) throw new KindFail("NOT_FOUND");
    if (!isKindDeal(c.deal)) throw new KindFail("KIND_TERMS_NOT_APPLICABLE");
    return c;
  };
  return {
    get: (who: PackWho, id: string): Promise<KindTermsView> =>
      d.uow.tenant(who, async (r) => {
        const c = await need(r, id);
        return view(c, await r.kindTerms.periodRows(id));
      }),
    /** `terms` đã qua zod của loại (strict); gộp lên giá trị cũ (khoá gửi `null` = xoá), chuẩn hoá, ghi + đặt hướng theo vai. */
    put: (who: PackWho, id: string, patch: Terms): Promise<KindTermsView> =>
      d.uow.tenant(who, async (r) => {
        const c = await need(r, id);
        if (c.status !== "draft") throw new KindFail("KIND_TERMS_LOCKED");
        const merged: Terms = { ...c.terms };
        for (const [k, v] of Object.entries(patch)) {
          if (v === null) delete merged[k];
          else merged[k] = v;
        }
        const terms = normalizeKindTerms(c.deal as "franchise" | "cooperation", merged);
        await r.kindTerms.saveTerms(
          id,
          terms,
          directionOfKind(c.deal as "franchise" | "cooperation", terms),
          who.userId,
        );
        return view({ ...c, terms }, await r.kindTerms.periodRows(id));
      }),
    /** Ghi doanh thu kỳ (nhượng quyền) / lợi nhuận–doanh thu chung (hợp tác) ⇒ tính số phí của mốc thu/trả kỳ đó. */
    record: (who: PackWho, id: string, key: string, figure: number): Promise<Period> =>
      d.uow.tenant(who, async (r) => {
        const c = await need(r, id);
        const rows = (await r.kindTerms.periodRows(id)).filter((x) => x.period_key === key);
        if (rows.length === 0) throw new KindFail("NOT_FOUND");
        if (!rows.some((x) => x.kind === "other")) throw new KindFail("KIND_TERMS_NOT_APPLICABLE");
        if (rows.some((x) => x.kind === "payment" && x.status === "done"))
          throw new KindFail("PERIOD_LOCKED");
        const fee = c.deal === "franchise" ? franchiseFee(c.terms, figure) : null;
        await r.kindTerms.recordPeriod(id, key, { figure, fee }, who.userId);
        const all = await r.kindTerms.periodRows(id);
        const p = view(c, all).periods.find((x) => x.key === key);
        if (!p) throw new KindFail("NOT_FOUND");
        return p;
      }),
  };
}
export type KindTermsUsecases = ReturnType<typeof kindTermsUsecases>;
