// CR-152 · luật thuần của trường riêng «Nhượng quyền» / «Thỏa thuận hợp tác»: trạng thái form (chuỗi) ↔ thân PUT kind-terms,
// ô nào hiện, tiền tính ra khi ghi doanh thu / đối soát kỳ (khớp máy chủ: % qua BigInt, làm tròn nửa lên tới đồng). Không React, không fetch.
import type { ContractDeal } from "@ai/contracts/pack-contracts";
import { parseMoney } from "~/components/shared/format";

export type KindDeal = "franchise" | "cooperation";
/** Mỗi trường = một chuỗi (ô nhập); ô tick: "1" có · "0" không · "" chưa trả lời. */
export type TermsState = Record<string, string>;

export const isKind = (d: ContractDeal | null | undefined): d is KindDeal =>
  d === "franchise" || d === "cooperation";

export const FRANCHISE_KEYS = [
  "role",
  "brand",
  "territory",
  "exclusive",
  "initial_fee",
  "fee_basis",
  "fee_pct",
  "fee_fixed",
  "period",
  "ad_fee_pct",
  "deposit",
  "foreign_franchisor",
  "moit_registered",
  "moit_registered_on",
] as const;
export const COOPERATION_KEYS = [
  "scope",
  "our_contribution",
  "partner_contribution",
  "split_basis",
  "our_share_pct",
  "settle_period",
] as const;
export const KEYS_OF: Record<KindDeal, readonly string[]> = {
  franchise: FRANCHISE_KEYS,
  cooperation: COOPERATION_KEYS,
};
const MONEY: ReadonlySet<string> = new Set(["initial_fee", "fee_fixed", "deposit"]);
const PCT: ReadonlySet<string> = new Set(["fee_pct", "ad_fee_pct", "our_share_pct"]);
const BOOL: ReadonlySet<string> = new Set(["exclusive", "foreign_franchisor", "moit_registered"]);

/** Giá trị máy chủ → ô form. */
export function termsOfServer(terms: Record<string, unknown> | null | undefined): TermsState {
  const out: TermsState = {};
  for (const [k, v] of Object.entries(terms ?? {})) {
    if (v === null || v === undefined) continue;
    out[k] = typeof v === "boolean" ? (v ? "1" : "0") : String(v);
  }
  return out;
}

/** Ô hiện theo giá trị đang chọn (Nhượng quyền: tỷ lệ/số tiền theo cách tính phí; Bộ Công Thương chỉ khi bên nhượng ở nước ngoài). */
export function visibleKeys(deal: KindDeal, t: TermsState): ReadonlySet<string> {
  const all = new Set(KEYS_OF[deal]);
  if (deal === "franchise") {
    if (t.fee_basis === "fixed") all.delete("fee_pct");
    else all.delete("fee_fixed");
    if (t.foreign_franchisor !== "1") {
      all.delete("moit_registered");
      all.delete("moit_registered_on");
    }
  } else if (t.split_basis === "none") {
    all.delete("our_share_pct");
    all.delete("settle_period");
  }
  return all;
}

export type TermsPut = { body: Record<string, string | number | boolean | null>; bad: string[] };

const num = (k: string, s: string): number | null =>
  MONEY.has(k) ? parseMoney(s) : s.trim() === "" ? null : Number(s.trim().replace(",", "."));

const BAD = Symbol("bad");

/** Một ô → giá trị gửi (rỗng ⇒ null); số sai ⇒ `BAD`. */
function putValue(k: string, raw: string): string | number | boolean | null | typeof BAD {
  if (raw === "") return null;
  if (BOOL.has(k)) return raw === "1";
  if (!MONEY.has(k) && !PCT.has(k)) return raw;
  const n = num(k, raw);
  return n === null || Number.isNaN(n) || (PCT.has(k) && (n < 0 || n > 100)) ? BAD : n;
}

/** Ô form → thân `PUT kind-terms` (ô rỗng / ẩn ⇒ `null` = xoá khoá). `bad` = ô số không đọc được hoặc % ngoài 0–100. */
export function termsToPut(deal: KindDeal, t: TermsState): TermsPut {
  const show = visibleKeys(deal, t);
  const body: TermsPut["body"] = {};
  const bad: string[] = [];
  for (const k of KEYS_OF[deal]) {
    const v = show.has(k) ? putValue(k, (t[k] ?? "").trim()) : null;
    if (v === BAD) bad.push(k);
    body[k] = v === BAD ? null : v;
  }
  return { body, bad };
}

/** Form khác bản đã lưu ở máy chủ? (so theo thân PUT, nên "rỗng" và "vắng" như nhau). */
export function termsDirty(deal: KindDeal, form: TermsState, saved: TermsState): boolean {
  const a = termsToPut(deal, form).body;
  const b = termsToPut(deal, saved).body;
  return KEYS_OF[deal].some((k) => a[k] !== b[k]);
}

/** Ô `terms.<khoá>` AI chưa chắc và người CHƯA sửa. */
export function unsureTerms(
  unsure: readonly string[] | undefined,
  form: TermsState,
  saved: TermsState,
): Set<string> {
  const out = new Set<string>();
  for (const u of unsure ?? []) {
    if (!u.startsWith("terms.")) continue;
    const k = u.slice(6);
    if ((form[k] ?? "") === (saved[k] ?? "")) out.add(k);
  }
  return out;
}

/** `figure × pct%` làm tròn nửa lên tới đồng (cùng công thức máy chủ). */
export const pctOf = (figure: number, pct: number): number =>
  Number((BigInt(figure) * BigInt(Math.round(pct * 100)) + 5_000n) / 10_000n);

type Saved = Record<string, unknown>;
const n = (v: unknown): number | null => (typeof v === "number" ? v : null);

/** Phí của kỳ khi đối tác báo `figure`: (cố định | % doanh thu) + % quảng cáo. Thiếu cấu hình ⇒ null. */
export function franchiseFee(terms: Saved, figure: number): number | null {
  const base = terms.fee_basis === "fixed" ? n(terms.fee_fixed) : fromPct(n(terms.fee_pct), figure);
  if (base === null) return null;
  return base + (fromPct(n(terms.ad_fee_pct), figure) ?? 0);
}
const fromPct = (p: number | null, figure: number): number | null =>
  p === null ? null : pctOf(figure, p);

/** Hợp tác: phần mình = % × số kỳ; phần đối tác = phần còn lại (tổng đúng từng đồng). */
export function coopShares(terms: Saved, figure: number): { our: number; partner: number } | null {
  const p = n(terms.our_share_pct);
  if (p === null) return null;
  const our = pctOf(figure, p);
  return { our, partner: figure - our };
}

/** Số tháng còn hiệu lực từ `today` tới `end` (YYYY-MM-DD); hết rồi / thiếu ngày ⇒ null. */
export function monthsLeft(today: string, end: string | null | undefined): number | null {
  if (!end) return null;
  const [y1, m1, d1] = today.split("-").map(Number) as [number, number, number];
  const [y2, m2, d2] = end.split("-").map(Number) as [number, number, number];
  const months = (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
  return Number.isNaN(months) || months < 0 ? null : months;
}
