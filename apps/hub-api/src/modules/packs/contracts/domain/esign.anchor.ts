// esign-anchor · luật thuần chọn VỊ TRÍ ô ký: văn bản HĐ có khối chữ ký cuối ("ĐẠI DIỆN BÊN A" / "BÊN BÁN"…) ⇒ đặt ô ký/ngày ngay dưới
// cụm đó trên trang HĐ (anchor văn bản DocuSign); không tìm thấy / mơ hồ / file scan không chữ ⇒ trang ký cuối (như cũ).
// So khớp: NFC, không phân biệt hoa thường, gộp khoảng trắng, nguyên từ. DocuSign đặt tab ở MỌI chỗ khớp ⇒ cụm phải xuất hiện đúng
// MỘT lần trong CẢ văn bản và lần đó nằm ở phần CUỐI (khối chữ ký).

export type AnchorLists = { a: string[]; b: string[] };
export type SignerRole = "company" | "partner";
/** Bên của CÔNG TY trong HĐ: bán (HĐ bán) / mua (HĐ mua) / không rõ. */
export type CompanySide = "seller" | "buyer" | null;
export type AnchorPick =
  | { mode: "text"; anchors: string[] }
  | { mode: "page"; reason: "no-text" | "signers" | "not-found" | "ambiguous" };

/** Mặc định Cài đặt › Ký số (sửa được theo công ty). Bên A = công ty, Bên B = đối tác (như trang ký cuối). */
export const DEFAULT_ANCHORS: AnchorLists = {
  a: ["ĐẠI DIỆN BÊN A", "BÊN A"],
  b: ["ĐẠI DIỆN BÊN B", "BÊN B"],
};
/** Cụm theo bên mua/bán — thêm SAU danh sách A/B theo hướng HĐ. */
export const SIDE_ANCHORS = {
  seller: ["ĐẠI DIỆN BÊN BÁN", "BÊN BÁN"],
  buyer: ["ĐẠI DIỆN BÊN MUA", "BÊN MUA"],
} as const;

/** Độ lệch (pixel) của ô ký/ngày so với góc trên-trái của cụm trong văn bản: ô nằm DƯỚI cụm (chừa dòng "(Ký, ghi rõ họ tên)").
 *  Chưa đo trên DocuSign thật — đo bằng `deploy/prod-sohoptac2/esign-layout` chế độ `text`. */
export const TEXT_TAB_OFFSET = {
  sign: { x: "0", y: "36" },
  date: { x: "0", y: "84" },
} as const;

/** Phần cuối văn bản = 30% cuối, tối thiểu 800 và tối đa 4000 ký tự (đã chuẩn hoá). */
const tailStart = (len: number) =>
  Math.max(0, len - Math.min(4000, Math.max(800, Math.ceil(len * 0.3))));

export const normText = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim();
const fold = (s: string) => s.toLowerCase();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = (phrase: string) =>
  new RegExp(
    `(?<![\\p{L}\\p{N}])${esc(fold(phrase)).replace(/ /g, "\\s")}(?![\\p{L}\\p{N}])`,
    "gu",
  );

/** Chuẩn hoá danh sách cụm: NFC, gộp khoảng trắng, bỏ rỗng/trùng (không phân biệt hoa thường). */
export function cleanList(xs: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const n = normText(x);
    if (n === "" || seen.has(fold(n))) continue;
    seen.add(fold(n));
    out.push(n);
  }
  return out;
}

type Hit = { start: number; end: number };
const hitsOf = (folded: string, phrase: string): Hit[] =>
  [...folded.matchAll(wordRe(phrase))].map((m) => ({ start: m.index, end: m.index + m[0].length }));

/** Cụm đầu tiên (theo thứ tự ưu tiên) xuất hiện đúng 1 lần trong cả văn bản và nằm ở phần cuối. */
function firstUnique(folded: string, from: number, cands: readonly string[]): Hit | null {
  for (const c of cands) {
    if (normText(c) === "") continue;
    const h = hitsOf(folded, normText(c));
    if (h.length === 1 && (h[0] as Hit).start >= from) return h[0] as Hit;
  }
  return null;
}

const L = "(?![\\p{L}\\p{N}])";
const BIND = [
  // "BÊN MUA (sau đây gọi là Bên A)", "Bên bán … gọi tắt là "Bên B""
  {
    re: new RegExp(
      `bên (mua|bán)${L}[^\\n]{0,120}?gọi (?:tắt )?là:?\\s*["“'(]?\\s*bên (a|b)${L}`,
      "u",
    ),
    side: 1,
    letter: 2,
  },
  // "BÊN MUA (BÊN A)"
  { re: /bên (mua|bán)\s*\(\s*bên (a|b)\s*\)/u, side: 1, letter: 2 },
  // "BÊN A (BÊN MUA)" / "BÊN A – BÊN BÁN"
  {
    re: new RegExp(`bên (a|b)\\s*[(:\\-–—]\\s*\\(?\\s*bên (mua|bán)${L}`, "u"),
    side: 2,
    letter: 1,
  },
] as const;

/** Chữ cái (a/b) của công ty: văn bản gán rõ "Bên mua = Bên X" ⇒ theo đó; không gán ⇒ "a"; gán mâu thuẫn ⇒ null (mơ hồ). */
export function companyLetter(folded: string, side: CompanySide): "a" | "b" | null {
  if (!side) return "a";
  const map = bindings(folded);
  if (!map) return null;
  const flip = (l: string) => (l === "a" ? "b" : "a");
  const other = map.get(side === "seller" ? "buyer" : "seller");
  const mine = map.get(side) ?? (other ? flip(other) : "a");
  return other === mine ? null : mine;
}

/** Gán bên mua/bán ⇒ chữ cái từ văn bản; mâu thuẫn ⇒ null. */
function bindings(folded: string): Map<string, "a" | "b"> | null {
  const map = new Map<string, "a" | "b">();
  for (const b of BIND) {
    for (const m of folded.matchAll(new RegExp(b.re.source, "gu"))) {
      const s = m[b.side] === "mua" ? "buyer" : "seller";
      const l = m[b.letter] as "a" | "b";
      if ((map.get(s) ?? l) !== l) return null;
      map.set(s, l);
    }
  }
  return map;
}

/** Chọn cụm anchor cho từng người ký (theo thứ tự). Tối đa 1 người ký mỗi vai; thiếu/mơ hồ ⇒ trang ký cuối. */
export function pickAnchors(o: {
  text: string | null;
  side: CompanySide;
  roles: readonly SignerRole[];
  lists: AnchorLists;
}): AnchorPick {
  const text = o.text ? normText(o.text) : "";
  if (text === "") return { mode: "page", reason: "no-text" };
  const n = (r: SignerRole) => o.roles.filter((x) => x === r).length;
  if (o.roles.length === 0 || n("company") > 1 || n("partner") > 1)
    return { mode: "page", reason: "signers" };
  const folded = fold(text);
  if (folded.length !== text.length) return { mode: "page", reason: "ambiguous" };
  const letter = companyLetter(folded, o.side);
  if (!letter) return { mode: "page", reason: "ambiguous" };
  const theirs = letter === "a" ? "b" : "a";
  const opp = o.side === "seller" ? "buyer" : o.side === "buyer" ? "seller" : null;
  const cands = {
    company: [...o.lists[letter], ...(o.side ? SIDE_ANCHORS[o.side] : [])],
    partner: [...o.lists[theirs], ...(opp ? SIDE_ANCHORS[opp] : [])],
  };
  const from = tailStart(folded.length);
  const hits = o.roles.map((r) => firstUnique(folded, from, cands[r]));
  if (hits.some((h) => h === null)) return { mode: "page", reason: "not-found" };
  const hs = hits as Hit[];
  const overlap = hs.some((a, i) =>
    hs.some((b, j) => i !== j && a.start < b.end && b.start < a.end),
  );
  if (overlap) return { mode: "page", reason: "ambiguous" };
  return { mode: "text", anchors: hs.map((h) => text.slice(h.start, h.end)) };
}

/** Bên của công ty từ `deal` (buy/sell/referral) hoặc `direction` (purchase/sale). Giới thiệu ⇒ không rõ. */
export function companySideOf(deal: string | null, direction: string | null): CompanySide {
  if (deal === "sell") return "seller";
  if (deal === "buy") return "buyer";
  if (deal === "referral") return null;
  if (direction === "sale") return "seller";
  if (direction === "purchase") return "buyer";
  return null;
}
