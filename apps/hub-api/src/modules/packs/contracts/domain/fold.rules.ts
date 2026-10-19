// HD-FR-07 · HD-AC04 · HD-BR-03 · D-07 · D-14 · D-15 · D-18 · plan §3–§4: bản TS của hàm SQL IMMUTABLE `contracts.fold` /
// `person_key` / `as_date` và hàm sinh khoá lọc (`signer_keys`, `search_key`). Thuần — chỉ built-in (ADR-0023).

const VI_LOWER: readonly (readonly [string, string])[] = [
  ["àáảãạăằắẳẵặâầấẩẫậ", "a"],
  ["èéẻẽẹêềếểễệ", "e"],
  ["ìíỉĩị", "i"],
  ["òóỏõọôồốổỗộơờớởỡợ", "o"],
  ["ùúủũụưừứửữự", "u"],
  ["ỳýỷỹỵ", "y"],
  ["đ", "d"],
];
// Giống SQL `translate`: chỉ chữ có dấu tiếng Việt (hoa+thường) và ASCII hoa; chữ hoa ngoài ASCII khác giữ nguyên (locale C).
const VI_MAP: ReadonlyMap<string, string> = new Map(
  VI_LOWER.flatMap(([chars, plain]) =>
    [...chars].flatMap((c) => [[c, plain] as const, [c.toUpperCase(), plain] as const]),
  ),
);

/** NFC (D-18) → bỏ dấu tiếng Việt, ASCII hoa→thường, gộp khoảng trắng ASCII, cắt hai đầu. */
export function foldVi(s: string): string {
  let out = "";
  for (const ch of s.normalize("NFC")) out += VI_MAP.get(ch) ?? ch;
  return out
    .replace(/[A-Z]/g, (c) => c.toLowerCase())
    .replace(/[ \t\n\r\f\v]+/g, " ")
    .trim();
}

const TITLE_SEPARATORS = [" – ", " - ", ","] as const;

/** Khoá người ký = `foldVi` phần tên trước chức danh (` – `, ` - `, `,`); rỗng ⇒ null. */
export function personKey(s: string | null): string | null {
  if (s === null) return null;
  let end = s.length;
  for (const sep of TITLE_SEPARATORS) {
    const i = s.indexOf(sep);
    if (i >= 0 && i < end) end = i;
  }
  return foldVi(s.slice(0, end)) || null;
}

/** Mẫu LIKE đã fold, thoát `\` `%` `_` (không bọc `%` — repo tự bọc). */
export function likePattern(q: string): string {
  return foldVi(q).replace(/[\\%_]/g, "\\$&");
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Ngày ISO hợp lệ (ngày ≤ số ngày của tháng, năm ≥ 1) ⇒ chính chuỗi; ngoài ra null, không ném (G2 · D-15). */
export function asDate(s: string | null): string | null {
  const m = s === null ? null : ISO_DATE.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1 || mo < 1 || mo > 12 || d < 1) return null;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const max = mo === 2 && leap ? 29 : (MONTH_DAYS[mo - 1] as number);
  return d <= max ? (s as string) : null;
}

/** `signer_keys`: khoá của người ký bên bán + bên mua, bỏ null (giữ thứ tự, không khử trùng như SQL `array_remove`). */
export function signerKeys(sellerSigner: string | null, buyerSigner: string | null): string[] {
  return [personKey(sellerSigner), personKey(buyerSigner)].filter((k): k is string => k !== null);
}

/** `search_key` (D-14): fold(title ' ' number ' ' supplier ' ' buyer ' ' rep ' ' rep), thiếu ⇒ ''. */
export function searchKey(parts: readonly (string | null | undefined)[]): string {
  return foldVi(parts.map((p) => p ?? "").join(" "));
}
