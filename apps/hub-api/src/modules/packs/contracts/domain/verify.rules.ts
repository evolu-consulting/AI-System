// HD-FR-22 · HD2 plan "Thiết kế hiệu năng": kiểm trích dẫn của agent trích (port `R/api/app/contracts/verify.py:1-70`).
// Quote phải có trong văn bản (chịu chữ PDF bị tách), số/ngày của giá trị phải nằm trong quote; số tiền tiếng Việt
// ("1,5 tỷ", "1.500 triệu", "245.000.000"). Văn bản chuẩn hoá MỘT lần (`prepareSource`) — ≤ 5 ms cho 30.000 ký tự. Thuần.
import { CONTRACT_FIELD_KEYS, type ContractFieldKey, type FieldValue } from "./fields.rules";

export type FieldKind = "text" | "enum" | "date" | "bool" | "int" | "float";

/** Kiểu từng khoá (`fields.py:3-11`); bản sao có chủ đích của `CONTRACT_FIELD_KINDS` (domain không import contract). */
export const FIELD_KIND: Record<ContractFieldKey, FieldKind> = {
  number: "text",
  title: "text",
  type: "enum",
  supplier_name: "text",
  supplier_tax_id: "text",
  supplier_address: "text",
  supplier_representative: "text",
  buyer_name: "text",
  buyer_tax_id: "text",
  buyer_representative: "text",
  signed_date: "date",
  start_date: "date",
  end_date: "date",
  effective_date: "date",
  auto_renew: "bool",
  notice_days: "int",
  total_value: "int",
  vat_rate: "float",
  vat_included: "bool",
  payment_terms: "text",
  delivery_terms: "text",
  warranty: "text",
  penalty: "text",
};

const MARKUP = /[*_|`#>]/g;
const SPACE = /\s+/g;
const MARKS = /\p{M}/gu;
/** Dấu nhóm nghìn: chỉ khi theo sau đúng 3 chữ số (không bao giờ khoảng trắng: "500 320.000" là hai số). */
const DIGIT_GROUP = /(?<=\d)[.,](?=\d{3}(?!\d))/g;
const WORD_MONEY = /(?<![\d.,])(\d+(?:,\d{1,2})?)\s*(ty|trieu|nghin)\b/g;
const PLAIN_NUMBER = /(?<![\d.,])\d+(?:,\d+)?/g;
const SCALE: Record<string, number> = { ty: 1e9, trieu: 1e6, nghin: 1e3 };

/** Bỏ dấu (NFD), chữ thường, `đ`→`d`, bỏ markup Markdown, gộp khoảng trắng (`verify.py:15`). */
export function norm(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(MARKS, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(MARKUP, " ")
    .replace(SPACE, " ")
    .trim();
}

/** Văn bản đã chuẩn hoá + bản bỏ khoảng trắng (tính một lần cho cả HĐ). */
export type PreparedSource = { norm: string; tight: string };
export function prepareSource(md: string): PreparedSource {
  const n = norm(md);
  return { norm: n, tight: n.replace(/ /g, "") };
}

/** Quote có trong văn bản; chữ PDF bị tách ("202 5") vẫn tính là có (so bản bỏ khoảng trắng). */
export function quoteFound(quote: string, src: PreparedSource): boolean {
  const q = norm(quote);
  return q.length > 0 && (src.norm.includes(q) || src.tight.includes(q.replace(/ /g, "")));
}

function dateForms(iso: string): string[] {
  const [y, m, d] = iso.split("-");
  const out: string[] = [];
  for (const dd of new Set([d, String(Number(d))]))
    for (const mm of new Set([m, String(Number(m))]))
      out.push(
        `${dd}/${mm}/${y}`,
        `${dd}-${mm}-${y}`,
        `${dd}.${mm}.${y}`,
        `ngay ${dd} thang ${mm} nam ${y}`,
      );
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Mọi số quote nêu (nhóm nghìn kiểu Việt, "tỷ/triệu/nghìn"); `q` đã chuẩn hoá. */
export function numbersIn(q: string): number[] {
  const grouped = q.replace(DIGIT_GROUP, "");
  const found: number[] = [];
  for (const m of grouped.matchAll(WORD_MONEY))
    found.push(Number((m[1] ?? "0").replace(",", ".")) * (SCALE[m[2] ?? ""] ?? 1));
  const rest = grouped.replace(WORD_MONEY, " ");
  for (const m of rest.matchAll(PLAIN_NUMBER)) found.push(Number(m[0].replace(",", ".")));
  return found;
}

/** Giá trị nằm trong quote: ngày (mọi cách viết, không dính chữ số khác), số (lệch < 0,5); kiểu khác ⇒ true. */
export function valueInQuote(kind: FieldKind, value: FieldValue, quote: string): boolean {
  const q = norm(quote);
  if (kind === "date") {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    return dateForms(value).some((f) => new RegExp(`(?<!\\d)${escapeRe(f)}(?!\\d)`).test(q));
  }
  if (kind === "int" || kind === "float") {
    const v = Number(value);
    return Number.isFinite(v) && numbersIn(q).some((n) => Math.abs(n - v) < 0.5);
  }
  return true;
}

export type RawField = { value: FieldValue; quote: string };
export type VerifiedField = RawField & { verified: boolean; edited: boolean };

function check(kind: FieldKind, f: RawField, src: PreparedSource): boolean {
  return f.value !== null && quoteFound(f.quote, src) && valueInQuote(kind, f.value, f.quote);
}

/** Đủ 23 khoá; `verified` = quote có trong văn bản và chứa giá trị; `edited=false` (bản trích của máy). */
export function verifyFields(
  raw: Partial<Record<ContractFieldKey, RawField>>,
  src: PreparedSource,
): Record<ContractFieldKey, VerifiedField> {
  return Object.fromEntries(
    CONTRACT_FIELD_KEYS.map((k) => {
      const f = raw[k] ?? { value: null, quote: "" };
      const quote = f.quote ?? "";
      return [
        k,
        {
          value: f.value,
          quote,
          verified: check(FIELD_KIND[k], { ...f, quote }, src),
          edited: false,
        },
      ];
    }),
  ) as Record<ContractFieldKey, VerifiedField>;
}

/** Dòng hàng: quote có trong văn bản và (không có đơn giá hoặc đơn giá nằm trong quote). */
export function itemVerified(
  it: { unit_price: number | null; quote: string },
  src: PreparedSource,
): boolean {
  return (
    quoteFound(it.quote, src) &&
    (it.unit_price === null || valueInQuote("int", it.unit_price, it.quote))
  );
}
