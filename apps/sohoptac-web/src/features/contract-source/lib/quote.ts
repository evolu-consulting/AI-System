// gap-a2 #3 · định vị đoạn trích dẫn của AI trong văn bản gốc (Markdown) để cuộn + tô sáng. Thuần, không I/O.
// AI hay chép lại kèm khác biệt nhỏ (hoa/thường, xuống dòng, dấu Markdown, "…" cắt giữa) ⇒ so khớp trên bản chuẩn hoá
// (gộp khoảng trắng, bỏ `* _ # > | \``, chữ thường) rồi ánh xạ ngược về vị trí trong văn bản gốc.
export type QuoteRange = { start: number; end: number };

const MD_NOISE = /[*_#>|`]/;
const QUOTE_MARKS = /^[\s"'“”‘’«»]+|[\s"'“”‘’«»]+$/g;
/** Đoạn ngắn hơn ngưỡng này (sau chuẩn hoá) dễ trùng nhầm ⇒ không dùng khi chỉ khớp một mảnh. */
const MIN_FRAGMENT = 8;

type Norm = { s: string; map: number[] };

function normalize(text: string): Norm {
  let s = "";
  const map: number[] = [];
  let gap = true; // đang ở khoảng trắng (bỏ khoảng trắng đầu)
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (/\s/.test(ch) || MD_NOISE.test(ch)) {
      if (!gap) {
        s += " ";
        map.push(i);
        gap = true;
      }
      continue;
    }
    const lower = ch.toLowerCase();
    s += lower.length === 1 ? lower : ch;
    map.push(i);
    gap = false;
  }
  if (s.endsWith(" ")) {
    s = s.slice(0, -1);
    map.pop();
  }
  return { s, map };
}

function findIn(n: Norm, needle: string): QuoteRange | null {
  if (!needle) return null;
  const at = n.s.indexOf(needle);
  if (at < 0) return null;
  const start = n.map[at];
  const last = n.map[at + needle.length - 1];
  return start === undefined || last === undefined ? null : { start, end: last + 1 };
}

/** Vị trí `[start, end)` của `quote` trong `text`; không thấy ⇒ `null`. Có "…"/"..." giữa câu ⇒ thử mảnh dài nhất. */
export function locateQuote(text: string, quote: string): QuoteRange | null {
  const q = quote.replace(QUOTE_MARKS, "");
  if (!q.trim() || !text) return null;
  const n = normalize(text);
  const whole = findIn(n, normalize(q).s);
  if (whole) return whole;
  const parts = q
    .split(/…|\.{3}/)
    .map((p) => normalize(p).s)
    .filter((p) => p.length >= MIN_FRAGMENT)
    .sort((a, b) => b.length - a.length);
  for (const p of parts) {
    const hit = findIn(n, p);
    if (hit) return hit;
  }
  return null;
}

/** Cắt văn bản thành 3 đoạn quanh vùng tô sáng; không có vùng ⇒ toàn bộ ở `before`. */
export function splitHighlight(
  text: string,
  r: QuoteRange | null,
): { before: string; hit: string; after: string } {
  if (!r) return { before: text, hit: "", after: "" };
  return {
    before: text.slice(0, r.start),
    hit: text.slice(r.start, r.end),
    after: text.slice(r.end),
  };
}
