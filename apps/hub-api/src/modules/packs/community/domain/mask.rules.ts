// COM-C4 · D4 · R39 · nghiep-vu §7: luật thuần dò/che liên hệ (SĐT, email, link, MST, tên công ty khác).
// Không import gì (lớp 1), không mạng, không DB. Offset của `Hit` tính trên văn bản đã chuẩn hoá `normalizeText`
// (NFKC: gộp NFC + chữ số full-width…), nên mọi hàm đều chuẩn hoá lại đầu vào và cho cùng kết quả với cùng văn bản.

export type ContactKind = "phone" | "email" | "link" | "tax_code" | "company_name";
export type Hit = { start: number; end: number; kind: ContactKind };
export type ScanContext = {
  /** Tên + bí danh của các công ty đối tác KHÁC cùng chủ quản (không gồm chính công ty người viết). */
  otherCompanies?: readonly string[];
};

/** Trần độ dài văn bản dò (ký tự). Quá trần ⇒ ném RangeError: đường ghi phải từ chối trước, không để đuôi lọt không che. */
export const MAX_TEXT_LENGTH = 100_000;
/** Tên công ty ngắn hơn ngưỡng (sau bỏ dấu) bị bỏ qua để khỏi che nhầm từ thường. */
export const MIN_COMPANY_NAME_LENGTH = 3;

export const MASK_PLACEHOLDERS: Record<ContactKind, string> = {
  phone: "[đã ẩn: số điện thoại]",
  email: "[đã ẩn: email]",
  link: "[đã ẩn: liên kết]",
  tax_code: "[đã ẩn: mã số thuế]",
  company_name: "[đã ẩn: tên công ty]",
};

// Ưu tiên khi hai hit trùng độ dài (lớn thắng).
const KIND_PRIORITY: Record<ContactKind, number> = {
  tax_code: 5,
  email: 4,
  link: 3,
  phone: 2,
  company_name: 1,
};

export function normalizeText(text: string): string {
  if (text.length > MAX_TEXT_LENGTH) {
    throw new RangeError(`mask: văn bản dài ${text.length} > ${MAX_TEXT_LENGTH}`);
  }
  return text.normalize("NFKC");
}

/** Bỏ dấu + hạ chữ thường, GIỮ NGUYÊN độ dài (từng code unit → đúng 1 code unit) để offset khớp văn bản gốc. */
export function foldText(text: string): string {
  const out: string[] = new Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 128) {
      out[i] = code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : (text[i] ?? "");
      continue;
    }
    if (code === 0x0111 || code === 0x0110) {
      out[i] = "d";
      continue;
    }
    const base = (text[i] ?? "").normalize("NFD").charAt(0).toLowerCase();
    out[i] = base.length === 1 ? base : (text[i] ?? "");
  }
  return out.join("");
}

// ---- Số điện thoại -------------------------------------------------------------------------
// Mỗi vòng lặp tiêu thụ đúng 1 chữ số (+ phân cách tuỳ chọn) ⇒ tuyến tính, không backtrack thảm hoạ.
const SEP = "(?:[ \\t\\u00a0.\\-]|\\)[ \\t\\u00a0.\\-]?)?\\(?";
const PHONE_RE = new RegExp(
  `(?<!\\d)(?<!\\d[.,/])(?:\\+[ \\t]?84|84|0)(?:${SEP}\\d){8,10}(?!\\d)`,
  "g",
);
const HOTLINE_RE = /(?<![\d.,/])1[89]00(?:[ \t.-]?\d){4,6}(?!\d)/g;
const DATE_IN_MATCH_RE = /\d{1,2}[./-]\d{1,2}[./-](?:19|20)\d{2}/;

function validPhone(raw: string): boolean {
  if (DATE_IN_MATCH_RE.test(raw)) return false;
  let d = raw.replace(/\D/g, "");
  if (raw.startsWith("+") || (d.startsWith("84") && !d.startsWith("0"))) {
    d = d.slice(2);
    if (!d.startsWith("0")) d = `0${d}`;
    else if (d.length === 10 || d.length === 11) {
      /* đã có số 0 trung kế: +84 0912… */
    }
  }
  if (d.length < 10 || d.length > 11) return false;
  return d.startsWith("0") && d[1] !== "0";
}

// ---- Email ---------------------------------------------------------------------------------
const EMAIL_RE = /(?<![a-z0-9._%+-])[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;
const EMAIL_OBFUSCATED_RE =
  /(?<![a-z0-9._%+-])[a-z0-9._%+-]+[ \t]*[[(][ \t]*(?:at|@)[ \t]*[\])][ \t]*[a-z0-9-]+(?:[ \t]*(?:\.|[[(][ \t]*(?:dot|\.)[ \t]*[\])])[ \t]*[a-z0-9-]+)+/gi;

// ---- Link ----------------------------------------------------------------------------------
const URL_TAIL = `(?:\\/[^\\s<>"'\\])]*)?`;
const SCHEME_URL_RE = /(?<![a-z0-9])(?:https?:\/\/|www\.)[^\s<>"'\])]+/gi;
const SOCIAL_RE = new RegExp(
  `(?<![a-z0-9@._-])(?:[a-z0-9-]+\\.)*(?:zalo\\.me|zaloapp\\.com|facebook\\.com|fb\\.com|fb\\.me|m\\.me|messenger\\.com|t\\.me|wa\\.me|tiktok\\.com|instagram\\.com|linkedin\\.com)(?![a-z0-9-])${URL_TAIL}`,
  "gi",
);
const DOMAIN_RE = new RegExp(
  `(?<![a-z0-9@._-])(?:[a-z0-9][a-z0-9-]*\\.)+(?:com\\.vn|net\\.vn|org\\.vn|edu\\.vn|gov\\.vn|com|net|org|vn|io|info|biz|asia|xyz|shop|store|online|site|tech|app)(?![a-z0-9-])${URL_TAIL}`,
  "gi",
);

// ---- Mã số thuế ----------------------------------------------------------------------------
const TAX_LABELED_RE =
  /(?<![a-z0-9])(?:ma[ \t]*so[ \t]*thue|ma[ \t]*so[ \t]*doanh[ \t]*nghiep|mst|msdn|m\.s\.t|tax[ \t]*(?:code|id|no|number)|vat[ \t]*(?:code|no|number|id))(?![a-z0-9])[ \t ]*(?:\([^)\n]{0,20}\))?[ \t ]*[:.\-=#]*[ \t ]*(\d{10}(?:[ \t]?-[ \t]?\d{3}|\d{3})?)(?!\d)/g;
const TAX_DASH_RE = /(?<![\d.,-])\d{10}[ \t]?-[ \t]?\d{3}(?!\d)/g;
const TAX_13_RE = /(?<![\d.,-])0\d{12}(?!\d)/g;

// ---- Tên công ty khác ----------------------------------------------------------------------
const matcherCache = new WeakMap<readonly string[], RegExp | null>();

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Biên dịch danh sách tên thành 1 regex (dài trước, nguyên từ, không dấu/không phân biệt hoa thường). */
export function compileCompanyMatcher(names: readonly string[]): RegExp | null {
  const folded = new Set<string>();
  for (const n of names) {
    const f = foldText(n.normalize("NFKC")).replace(/\s+/g, " ").trim();
    if (f.length >= MIN_COMPANY_NAME_LENGTH) folded.add(f);
  }
  if (folded.size === 0) return null;
  const alts = [...folded]
    .sort((a, b) => b.length - a.length)
    .map((f) => f.split(" ").map(escapeRe).join("\\s+"));
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts.join("|")})(?![\\p{L}\\p{N}])`, "gu");
}

function companyMatcher(names: readonly string[] | undefined): RegExp | null {
  if (!names || names.length === 0) return null;
  const cached = matcherCache.get(names);
  if (cached !== undefined) return cached;
  const re = compileCompanyMatcher(names);
  matcherCache.set(names, re);
  return re;
}

// ---- Quét ----------------------------------------------------------------------------------
function trimTrailingPunct(s: string): number {
  let n = s.length;
  while (n > 0 && /[.,;:!?)\]'"]/.test(s.charAt(n - 1))) n--;
  return n;
}

/** Gộp các hit chồng nhau thành một khoảng hợp (không để lọt phần dư); kind theo thành phần dài nhất. */
export function resolveOverlaps(hits: readonly Hit[]): Hit[] {
  const sorted = [...hits].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Hit[] = [];
  let cur: Hit | null = null;
  let best = { len: 0, prio: 0 };
  for (const h of sorted) {
    const len = h.end - h.start;
    const prio = KIND_PRIORITY[h.kind];
    if (cur && h.start < cur.end) {
      cur.end = Math.max(cur.end, h.end);
      if (len > best.len || (len === best.len && prio > best.prio)) {
        best = { len, prio };
        cur.kind = h.kind;
      }
    } else {
      if (cur) out.push(cur);
      cur = { ...h };
      best = { len, prio };
    }
  }
  if (cur) out.push(cur);
  return out;
}

type Sink = (start: number, end: number, kind: ContactKind) => void;
const idx = (m: RegExpMatchArray): number => m.index ?? 0;

function scanPhones(t: string, add: Sink): void {
  for (const m of t.matchAll(PHONE_RE)) {
    const raw = m[0];
    if (!validPhone(raw)) continue;
    let start = idx(m);
    // "(028) 3822 1234": dấu ")" nằm trong hit thì kéo "(" đứng ngay trước vào cho cân.
    if (raw.includes(")") && !raw.includes("(") && t[start - 1] === "(") start--;
    add(start, idx(m) + raw.length, "phone");
  }
  for (const m of t.matchAll(HOTLINE_RE)) add(idx(m), idx(m) + m[0].length, "phone");
}

function scanEmails(t: string, add: Sink): void {
  for (const re of [EMAIL_RE, EMAIL_OBFUSCATED_RE]) {
    for (const m of t.matchAll(re)) add(idx(m), idx(m) + m[0].length, "email");
  }
}

function scanLinks(t: string, add: Sink): void {
  for (const re of [SCHEME_URL_RE, SOCIAL_RE, DOMAIN_RE]) {
    for (const m of t.matchAll(re)) {
      const raw = m[0].slice(0, trimTrailingPunct(m[0]));
      if (re === DOMAIN_RE && !/^[a-z0-9-]*[a-z]/i.test(raw)) continue; // "3.800.com" không phải tên miền
      add(idx(m), idx(m) + raw.length, "link");
    }
  }
}

function scanTaxCodes(t: string, folded: string, add: Sink): void {
  for (const m of folded.matchAll(TAX_LABELED_RE)) add(idx(m), idx(m) + m[0].length, "tax_code");
  for (const re of [TAX_DASH_RE, TAX_13_RE]) {
    for (const m of t.matchAll(re)) add(idx(m), idx(m) + m[0].length, "tax_code");
  }
}

function scanCompanies(folded: string, names: readonly string[] | undefined, add: Sink): void {
  const re = companyMatcher(names);
  if (!re) return;
  for (const m of folded.matchAll(re)) add(idx(m), idx(m) + m[0].length, "company_name");
}

/** Dò liên hệ. Offset tính trên `normalizeText(text)`. Ném RangeError nếu quá `MAX_TEXT_LENGTH`. */
export function scanContacts(text: string, ctx: ScanContext = {}): Hit[] {
  const t = normalizeText(text);
  if (t.length === 0) return [];
  const hits: Hit[] = [];
  const add: Sink = (start, end, kind) => {
    if (end > start) hits.push({ start, end, kind });
  };
  const folded = foldText(t);
  scanPhones(t, add);
  scanEmails(t, add);
  scanLinks(t, add);
  scanTaxCodes(t, folded, add);
  scanCompanies(folded, ctx.otherCompanies, add);
  return resolveOverlaps(hits);
}
/** Thay mỗi hit bằng placeholder cố định theo kind. `hits` phải đến từ `scanContacts` của cùng `text`. */
export function maskText(text: string, hits: readonly Hit[]): string {
  const t = normalizeText(text);
  let out = "";
  let pos = 0;
  for (const h of resolveOverlaps(hits)) {
    const start = Math.max(h.start, pos);
    const end = Math.min(h.end, t.length);
    if (end <= start) continue;
    out += t.slice(pos, start) + MASK_PLACEHOLDERS[h.kind];
    pos = end;
  }
  return out + t.slice(pos);
}

const LABEL_BEFORE_RE =
  /(?:sdt|dt|tel|hotline|zalo|phone|dien[ \t]*thoai|e-?mail|mail|website|web|facebook|fb|lien[ \t]*he|lh|contact|mst|ma[ \t]*so[ \t]*thue)[ \t ]*[:=\-–]?[ \t ]*$/;

/** Bỏ hẳn liên hệ (cho "Đăng lại dưới tên mình"): xoá hit + nhãn đứng trước ("SĐT:", "Zalo"), dọn khoảng trắng/dấu câu. */
export function stripContacts(text: string, hits: readonly Hit[]): string {
  const t = normalizeText(text);
  const folded = foldText(t);
  let out = "";
  let pos = 0;
  for (const h of resolveOverlaps(hits)) {
    let start = Math.max(h.start, pos);
    const end = Math.min(h.end, t.length);
    if (end <= start) continue;
    const winStart = Math.max(pos, start - 40);
    for (let lab = LABEL_BEFORE_RE.exec(folded.slice(winStart, start)); lab; ) {
      start = winStart + lab.index; // nhãn liên tiếp: "Liên hệ Zalo"
      lab = LABEL_BEFORE_RE.exec(folded.slice(winStart, start));
    }
    out += t.slice(pos, start);
    pos = end;
  }
  out += t.slice(pos);
  return tidy(out);
}

function tidy(s: string): string {
  return s
    .replace(/\(\s*\)|\[\s*\]/g, "")
    .replace(/[ \t ]+([,.;:!?])/g, "$1")
    .replace(/([,;])(?:[ \t]*[,;])+/g, "$1")
    .replace(/[ \t ]{2,}/g, " ")
    .replace(/^[ \t]+|[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Tiện cho đường ghi: dò + che một lượt. `contactDetected` = cờ nhắc người đăng (HT-54). */
export function maskContacts(
  text: string,
  ctx: ScanContext = {},
): { masked: string; hits: Hit[]; contactDetected: boolean } {
  const hits = scanContacts(text, ctx);
  return { masked: maskText(text, hits), hits, contactDetected: hits.length > 0 };
}
