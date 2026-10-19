// HD-FR-54 · D-HD5-02 · port `contracts/link.py:heuristic/find_parent/same_supplier` (không LLM/RAG): gợi ý HĐ gốc của một phụ lục.
// Thứ tự: (1) số HĐ nêu trong văn bản phụ lục, (2) cùng cả hai bên, (3) cùng bên bán. Thuần.
import { foldVi } from "./fold.rules";
import { partyForm } from "./party.rules";

export const SUGGEST_MAX = 5;
/** `link.py:_HEAD`: chỉ đọc đầu văn bản. */
export const SUGGEST_HEAD_CHARS = 4000;

export type ParentCandidate = {
  id: string;
  title: string;
  number: string | null;
  seller: string | null;
  buyer: string | null;
};
export type SuggestReason = "cited_number" | "same_parties" | "same_supplier";
export type Suggestion = ParentCandidate & { reason: SuggestReason };

/** Trên văn bản đã fold (không dấu, chữ thường): "hop dong ... so 01/2026". */
const CONTRACT_NO = /hop\s*dong[^\n]{0,60}?so\s*:?\s*([^\s,;()]+)/;

/** Khoá so số HĐ: fold + bỏ ký tự không phải chữ/số ("01/2026/HĐMB-PN" ≡ "01-2026-hdmb-pn"). */
export const numberKey = (s: string | null | undefined): string =>
  foldVi(s ?? "").replace(/[^\p{L}\p{N}]/gu, "");

/** Số HĐ gốc mà phụ lục nêu ("… hợp đồng số 01/2026/HĐMB-PN"), tìm sau dòng tiêu đề phụ lục (dòng tiêu đề mang số phụ lục). Trả về dạng đã fold — chỉ để so khoá. */
export function citedNumber(sourceText: string | null): string | null {
  const head = (sourceText ?? "").slice(0, SUGGEST_HEAD_CHARS);
  const lines = head.split("\n").filter((l) => l.trim());
  const i = lines.findIndex((l) => /^[#*\s]*(phu\s*luc|bien\s*ban\s*sua\s*doi)/i.test(foldVi(l)));
  const rest = lines
    .slice(i < 0 ? 0 : i + 1, 12)
    .map((l) => foldVi(l))
    .join("\n");
  const m = CONTRACT_NO.exec(rest);
  if (!m?.[1]) return null;
  return m[1].replace(/[.:]+$/, "");
}

export type AppendixHints = {
  cited: string | null;
  seller: string | null;
  buyer: string | null;
};

/** `candidates` = HĐ gốc khác trong tenant (đã lọc `kind = contract`, khác chính nó). Tối đa `SUGGEST_MAX`, ổn định theo thứ tự vào. */
export function suggestParents(
  h: AppendixHints,
  candidates: readonly ParentCandidate[],
): Suggestion[] {
  const cited = h.cited ? numberKey(h.cited) : "";
  const mineSeller = partyForm(h.seller);
  const mineBuyer = partyForm(h.buyer);
  const same = (a: string, b: string): boolean =>
    a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a));
  const out: (Suggestion & { rank: number })[] = [];
  for (const c of candidates) {
    const sellerOk = same(mineSeller, partyForm(c.seller));
    const buyerOk = same(mineBuyer, partyForm(c.buyer));
    if (cited && numberKey(c.number) === cited) out.push({ ...c, reason: "cited_number", rank: 0 });
    else if (sellerOk && buyerOk) out.push({ ...c, reason: "same_parties", rank: 1 });
    else if (sellerOk) out.push({ ...c, reason: "same_supplier", rank: 2 });
  }
  return out
    .sort((a, b) => a.rank - b.rank)
    .slice(0, SUGGEST_MAX)
    .map(({ rank: _r, ...s }) => s);
}
