// CR-178 M3 · luật thuần của tìm tin: bỏ dấu/hoa (khớp `hub.fold` ở DB), thoát ký tự LIKE, đoạn trích quanh chỗ khớp, con trỏ phân trang. Không I/O.
import { MSG_SNIPPET_MAX } from "@ai/contracts/pack-contracts";

/** Thoát `\ % _` để `q` là chuỗi chứa thuần (LIKE … ESCAPE mặc định `\`). */
export const escapeLike = (q: string): string => q.replace(/[\\%_]/g, "\\$&");

/** Bỏ dấu + chữ thường, như `hub.fold` (unaccent + lower): NFD bỏ dấu kết hợp; `đ` không tách được nên đổi tay. */
export const foldText = (s: string): string =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/đ/g, "d");

const graphemes = (s: string): string[] =>
  Array.from(
    new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s),
    (x) => x.segment,
  );

export type Snippet = { snippet: string; match: { start: number; end: number } | null };

/** Cửa sổ [ws, we) của đoạn trích (đơn vị = cụm ký tự); chừa 1 ký tự cho «…» mỗi đầu bị cắt, tổng ≤ `max`. */
function windowOf(len: number, from: number, to: number, max: number, found: boolean) {
  if (len <= max) return { ws: 0, we: len };
  const room = max - 2;
  if (!found) return { ws: 0, we: max - 1 };
  const mlen = Math.min(to - from, room);
  const we0 = Math.min(len, Math.max(0, from - Math.floor((room - mlen) / 2)) + room);
  const ws = Math.max(0, we0 - room); // sát đuôi ⇒ lùi đầu cửa sổ cho đủ `room`
  return { ws, we: ws === 0 ? Math.min(len, max - 1) : we0 }; // không «…» đầu ⇒ thêm 1 ký tự chỗ
}

/**
 * Đoạn trích ≤ `max` ký tự (đơn vị = cụm ký tự hiển thị ⇒ không cắt đôi cặp thay thế / emoji ghép) quanh chỗ khớp đầu tiên của `q` (không phân biệt hoa/dấu); gộp khoảng trắng
 * thành một dòng; «…» ở đầu/cuối khi bị cắt (tính trong `max`). `match` = [start, end) theo chỉ số UTF-16 trong `snippet`; không tìm thấy ⇒ trích từ đầu, `match` null.
 */
export function snippetOf(body: string, q: string, max = MSG_SNIPPET_MAX): Snippet {
  const gs = graphemes(body.replace(/\s+/g, " ").trim());
  let folded = "";
  const owner: number[] = []; // vị trí UTF-16 trong `folded` → chỉ số cụm ký tự
  gs.forEach((g, i) => {
    const f = foldText(g);
    for (let k = 0; k < f.length; k++) owner.push(i);
    folded += f;
  });
  const fq = foldText(q.replace(/\s+/g, " ").trim());
  const pos = fq === "" ? -1 : folded.indexOf(fq);
  const from = pos < 0 ? 0 : (owner[pos] ?? 0);
  const to = pos < 0 ? 0 : (owner[pos + fq.length - 1] ?? from) + 1;
  const { ws, we } = windowOf(gs.length, from, to, max, pos >= 0);
  const head = ws > 0 ? "…" : "";
  const tail = we < gs.length ? "…" : "";
  const snippet = head + gs.slice(ws, we).join("") + tail;
  if (pos < 0) return { snippet, match: null };
  const start = head.length + gs.slice(ws, from).join("").length;
  return {
    snippet,
    match: { start, end: start + gs.slice(from, Math.min(to, we)).join("").length },
  };
}

// ---- con trỏ: (thời điểm tin ISO µs, id cuộc, seq) — khoá keyset duy nhất `(created_at, conversation_id, seq)` DESC ----
export type SearchCursor = { at: string; cid: string; seq: number };
const AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const encodeSearchCursor = (c: SearchCursor): string =>
  Buffer.from(JSON.stringify([c.at, c.cid, c.seq])).toString("base64url");
export function decodeSearchCursor(s: string): SearchCursor | null {
  try {
    const v: unknown = JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
    if (!Array.isArray(v) || v.length !== 3) return null;
    const [at, cid, seq] = v;
    return typeof at === "string" &&
      AT_RE.test(at) &&
      typeof cid === "string" &&
      UUID_RE.test(cid) &&
      typeof seq === "number" &&
      Number.isSafeInteger(seq) &&
      seq >= 1
      ? { at, cid: cid.toLowerCase(), seq }
      : null;
  } catch {
    return null;
  }
}
type Keyed = { at: string; conversation_id: string; seq: number };
/** Thứ tự kết quả: mới nhất trước, rồi id cuộc, rồi seq (cùng thứ tự `order by` ở SQL; ISO µs và uuid thường so được theo chuỗi). */
export function newerFirst(a: Keyed, b: Keyed): number {
  if (a.at !== b.at) return a.at < b.at ? 1 : -1;
  if (a.conversation_id !== b.conversation_id)
    return a.conversation_id < b.conversation_id ? 1 : -1;
  return b.seq - a.seq;
}
