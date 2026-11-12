// CR-127 · U5 · BR-55/56 · M9: thẻ "Điều cần lưu ý" (AI tóm từ văn bản, mỗi ý kèm điều khoản + trang) và "Cần chú ý" (rủi ro). Thay "Tóm tắt hợp đồng". Thuần.
import type { AiNote, AiRisk, ContractDetail, PenaltyTerm } from "@ai/contracts/pack-contracts";

export const NOTE_GROUPS = [
  "penalty",
  "payment",
  "delivery",
  "warranty",
  "renewal",
  "dispute",
] as const;

export type NoticeGroup = {
  group: (typeof NOTE_GROUPS)[number];
  /** Ý từ AI (text tự do). */
  notes: AiNote[];
  /** Điều khoản phạt dạng số (chỉ nhóm `penalty`). */
  terms: PenaltyTerm[];
};

/** Nhóm theo thứ tự cố định; nhóm trống bỏ. Phạt số ghép vào nhóm "penalty" (hiện trước các ý chữ). */
export function noticeGroups(c: Pick<ContractDetail, "ai" | "penalty_terms">): NoticeGroup[] {
  const notes = c.ai?.notes ?? [];
  const terms = c.penalty_terms ?? [];
  return NOTE_GROUPS.map((g) => ({
    group: g,
    notes: notes.filter((n) => n.group === g),
    terms: g === "penalty" ? terms : [],
  })).filter((g) => g.notes.length > 0 || g.terms.length > 0);
}

export const risksOf = (c: Pick<ContractDetail, "ai">): AiRisk[] => c.ai?.risks ?? [];

/** "Điều 8.1 · trang 3" / "Điều 8.1" / null. */
export const citeOf = (x: {
  clause_ref?: string | null | undefined;
  page?: number | null | undefined;
}): string | null =>
  x.clause_ref
    ? x.page
      ? `${x.clause_ref} · tr.${x.page}`
      : x.clause_ref
    : x.page
      ? `tr.${x.page}`
      : null;

/** Khoá i18n + tham số của một điều khoản phạt số: "Đối tác trả chậm: 0,05%/ngày trên số tiền chậm, tối đa 8%". */
export function termKey(t: PenaltyTerm): { key: string; rate: string; cap: string | null } {
  const rate = t.rate_pct === null ? "" : String(t.rate_pct).replace(".", ",");
  const cap =
    t.cap_pct != null
      ? `${String(t.cap_pct).replace(".", ",")}%`
      : t.cap_amount != null
        ? String(t.cap_amount)
        : null;
  return { key: `${t.party}.${t.trigger}.${t.basis}`, rate, cap };
}
