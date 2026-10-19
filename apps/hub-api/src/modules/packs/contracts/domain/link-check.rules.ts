// HD8-FR-05 · D8-10 · port `mgmt-app/api/app/prices/link_check.py` (phần thuần): số tiền trên trang, chữ của trang, ngày trang ghi
// cập nhật/đăng, địa chỉ IP công khai. Không I/O.

const NUM = /\d{1,3}(?:[.,\s ]\d{3})+|\d{4,}/g;
const VI_DATE = String.raw`(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4})`;
const META_PUB = [
  "article:published_time",
  "og:published_time",
  "datepublished",
  "pubdate",
  "publish_date",
  "dc.date.issued",
  "dc.date",
];
const META_MOD = ["article:modified_time", "og:updated_time", "datemodified", "last-modified"];

/** `numbers_in`: mọi số ≥ 4 chữ số (có/không dấu phân nhóm) trên trang. */
export function numbersIn(text: string): Set<number> {
  return new Set([...text.matchAll(NUM)].map((m) => Number(m[0].replace(/\D/g, ""))));
}

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};
/** `html.unescape` (số + các tên hay gặp trên trang giá). */
export function unescapeHtml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, g: string) => {
    if (g[0] === "#") {
      const n = g[1] === "x" || g[1] === "X" ? Number.parseInt(g.slice(2), 16) : Number(g.slice(1));
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return NAMED[g.toLowerCase()] ?? m;
  });
}

/** `page_text`: bỏ script/style/noscript và thẻ, giải thực thể, gộp khoảng trắng. */
export function pageText(raw: string): string {
  const s = raw
    .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return unescapeHtml(s).replace(/\s+/g, " ");
}

/** `norm_date`: `YYYY-MM-DD` hoặc `D/M/YYYY` ⇒ ISO; ngày thật, năm 2005…năm nay + 1. */
export function normDate(s: unknown, thisYear: number): string | null {
  if (!s) return null;
  const str = String(s);
  let y: number;
  let mo: number;
  let d: number;
  const iso = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(str);
  if (iso) [y, mo, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else {
    const vi = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(str);
    if (!vi) return null;
    [d, mo, y] = [Number(vi[1]), Number(vi[2]), Number(vi[3])];
  }
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d)
    return null;
  return y >= 2005 && y <= thisYear + 1 ? dt.toISOString().slice(0, 10) : null;
}

function metaOf(raw: string): Map<string, string> {
  const meta = new Map<string, string>();
  for (const tag of raw.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = /(?:property|name|itemprop)\s*=\s*["']([^"']+)/i.exec(tag);
    const val = /content\s*=\s*["']([^"']+)/i.exec(tag);
    const k = key?.[1]?.trim().toLowerCase();
    if (k && val?.[1] && !meta.has(k)) meta.set(k, val[1]);
  }
  return meta;
}

/** `page_date`: trang nói cập nhật/đăng ngày nào (meta, JSON-LD, chữ "Cập nhật …"). */
export function pageDate(raw: string, thisYear: number): string | null {
  const meta = metaOf(raw);
  for (const k of [...META_MOD, ...META_PUB]) {
    const d = normDate(meta.get(k), thisYear);
    if (d) return d;
  }
  for (const ld of ["dateModified", "datePublished"]) {
    const m = new RegExp(`"${ld}"\\s*:\\s*"([^"]+)"`).exec(raw);
    const d = normDate(m?.[1], thisYear);
    if (d) return d;
  }
  const m = new RegExp(
    String.raw`(?:cập nhật|updated|ngày đăng|áp dụng)\D{0,25}` + VI_DATE,
    "i",
  ).exec(pageText(raw));
  return m ? normDate(m[1], thisYear) : null;
}

const V4_BLOCK: [number, number][] = [
  [0x00000000, 8],
  [0x0a000000, 8],
  [0x64400000, 10],
  [0x7f000000, 8],
  [0xa9fe0000, 16],
  [0xac100000, 12],
  [0xc0000000, 24],
  [0xc0000200, 24],
  [0xc0a80000, 16],
  [0xc6120000, 15],
  [0xc6336400, 24],
  [0xcb007100, 24],
  [0xe0000000, 4],
  [0xf0000000, 4],
];

function v4Public(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return false;
  const n =
    (((p[0] as number) << 24) |
      ((p[1] as number) << 16) |
      ((p[2] as number) << 8) |
      (p[3] as number)) >>>
    0;
  return !V4_BLOCK.some(([net, bits]) => n >>> (32 - bits) === net >>> (32 - bits));
}

/** `ipaddress.ip_address(a).is_global` (chặt hơn một chút: chặn cả multicast). IPv6 ánh xạ IPv4 xét phần IPv4. */
export function isPublicIp(addr: string): boolean {
  const ip = addr.split("%")[0]?.toLowerCase() ?? "";
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return v4Public(ip);
  if (!ip.includes(":")) return false;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) return v4Public(mapped[1] as string);
  if (ip === "::" || ip === "::1") return false;
  const head = Number.parseInt(ip.split(":")[0] || "0", 16);
  if ((head & 0xfe00) === 0xfc00 || (head & 0xffc0) === 0xfe80 || (head & 0xff00) === 0xff00)
    return false;
  if (
    ip.startsWith("2001:db8") ||
    ip.startsWith("64:ff9b") ||
    ip.startsWith("2002:") ||
    ip.startsWith("2001:0:")
  )
    return false;
  return (head & 0xe000) === 0x2000; // chỉ dải unicast toàn cầu 2000::/3
}

export type LinkCheck = { verified: boolean; page_date: string | null; note: string };
/** Cổng: mở link giá và kiểm con số (adapter `link-check.http.ts`). */
export type Inspect = (url: string, price: number) => Promise<LinkCheck>;
export const NOTE = {
  invalid: "Link không hợp lệ",
  found: "Đã thấy đúng con số trên trang",
  missing: "Không thấy con số này trên trang (có thể giá nằm trong ảnh)",
  failed: (why: string) => `Không mở được trang (${why})`,
};

/** `inspect` sau khi đã có trang: thấy đúng con số ⇒ đã kiểm. */
export function judge(raw: string, price: number, thisYear: number): LinkCheck {
  const found = numbersIn(pageText(raw)).has(price);
  return {
    verified: found,
    page_date: pageDate(raw, thisYear),
    note: found ? NOTE.found : NOTE.missing,
  };
}
