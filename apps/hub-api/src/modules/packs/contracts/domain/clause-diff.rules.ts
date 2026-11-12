// CR-127 K5 · BR-36 / BR-36a · spec §4: so sánh VĂN BẢN hai bản theo điều khoản (tab "Đã đổi so với lần trước" + diff hai phiên bản).
// Thuần (không DB). Tách văn bản trích (`source_text`) theo đầu mục "Điều N"; phần trước "Điều" đầu tiên = "Mở đầu".
// `requested` = ý kiến người Trả lại lần trước có nhắc tới điều khoản đó (khớp "Điều N", không phân biệt dấu / hoa thường).

export type ClauseChange = {
  ref: string;
  changed: boolean;
  before: string | null;
  after: string | null;
};
export type ClauseChangeRequested = ClauseChange & { requested: boolean };

/** Trần chữ mỗi đoạn trả về (chặn phản hồi phình). */
export const CLAUSE_TEXT_MAX = 4000;
export const PREAMBLE_REF = "Mở đầu";

const HEAD = /^\s*(?:Điều|Dieu)\s+(\d{1,3})\b/i;
const squash = (s: string): string => s.replace(/\s+/g, " ").trim();
const cut = (s: string): string =>
  s.length > CLAUSE_TEXT_MAX ? `${s.slice(0, CLAUSE_TEXT_MAX)}…` : s;

/** Văn bản ⇒ [ref, nội dung] theo thứ tự xuất hiện; cùng số điều lặp lại ⇒ nối vào lần đầu. */
export function splitClauses(text: string | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!text) return out;
  let ref = PREAMBLE_REF;
  const buf: string[] = [];
  const flush = () => {
    const body = squash(buf.join(" "));
    buf.length = 0;
    if (body === "" && ref === PREAMBLE_REF) return;
    out.set(ref, out.has(ref) ? `${out.get(ref)} ${body}`.trim() : body);
  };
  for (const line of text.split(/\r?\n/)) {
    const m = HEAD.exec(line);
    if (m) {
      flush();
      ref = `Điều ${Number(m[1])}`;
    }
    buf.push(line);
  }
  flush();
  return out;
}

/** Mọi điều khoản của hai bản (thứ tự: bản sau, rồi điều chỉ có ở bản trước). Đổi = nội dung khác sau khi chuẩn hoá khoảng trắng. */
export function diffClauses(before: string | null, after: string | null): ClauseChange[] {
  const a = splitClauses(before);
  const b = splitClauses(after);
  const refs = [...b.keys(), ...[...a.keys()].filter((k) => !b.has(k))];
  return refs.map((ref) => {
    const x = a.get(ref) ?? null;
    const y = b.get(ref) ?? null;
    const changed = x !== y;
    return {
      ref,
      changed,
      before: changed ? cut(x ?? "") || null : null,
      after: changed ? cut(y ?? "") || null : null,
    };
  });
}

const fold = (s: string): string =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();

/** Ý kiến lần Trả lại có nhắc tới điều khoản `ref` ("Điều 5" không khớp "Điều 51"). */
export function mentionsRef(note: string | null, ref: string): boolean {
  if (!note || ref === PREAMBLE_REF) return false;
  const n = /(\d+)$/.exec(ref)?.[1];
  if (!n) return false;
  return new RegExp(String.raw`\bdieu\s*0*${n}(?!\d)`).test(fold(note));
}

/** Điều khoản đổi HOẶC được nhắc trong yêu cầu lần trước, kèm cờ `requested`. */
export function changesSinceLast(
  before: string | null,
  after: string | null,
  returnNote: string | null,
): ClauseChangeRequested[] {
  return diffClauses(before, after)
    .map((c) => ({ ...c, requested: mentionsRef(returnNote, c.ref) }))
    .filter((c) => c.changed || c.requested);
}
