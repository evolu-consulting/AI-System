// CHAT-AC-51 · CHAT-AC-52 · luật thuần `!key` ở composer (plan §7; bản gốc phía Hub: `core/bang.rules.ts`).
// Mở menu, lọc (bỏ dấu), điền `!key `, phân loại tin ở Hỏi AI. Không phụ thuộc React.
import { PROCESS_KEY_RE, type ProcessCatalogItem } from "@ai/contracts/chat";

/** Một dòng của menu `!` (cùng dạng `AgentMatch`/`CommandMatch`: `{ item }`). */
export type ProcessMatch = { item: ProcessCatalogItem };

/** Kết quả phân loại tin gõ ở composer chính (Hỏi AI): `none` = gửi như chữ thường (đường cũ, Hub xử lý `!!`/`!` trơn). */
export type BangClass = { kind: "none" } | { kind: "run"; key: string; input: string };

const WS = /[ \t\n\r\f\v]/;
const LEADING_WS = /^[ \t\n\r\f\v]+/;
const TRAILING_WS = /[ \t\n\r\f\v]+$/;

/** Phần gõ sau `!` khi menu phải mở: `!` ở đầu tin, không `!!`, con trỏ nằm trong token đầu (chưa gõ khoảng trắng). Khác ⇒ `null`. */
export function bangQuery(text: string, caret: number): string | null {
  if (!text.startsWith("!") || text.startsWith("!!")) return null;
  const c = Math.min(Math.max(caret, 0), text.length);
  if (c < 1) return null;
  const head = text.slice(1, c);
  return WS.test(head) ? null : head;
}

/** Bỏ dấu + chữ thường (đ→d) để "hoa don" khớp "Hoá đơn". */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();
}

/** `key` chứa phần gõ hoặc tên (bỏ dấu) chứa nó. Giữ thứ tự server (theo tên). */
export function filterProcesses(items: readonly ProcessCatalogItem[], q: string): ProcessMatch[] {
  const needle = fold(q);
  return items
    .filter((i) => fold(i.key).includes(needle) || fold(i.name).includes(needle))
    .map((item) => ({ item }));
}

/** Điền `!key ` thay token đầu, giữ phần chữ còn lại; con trỏ ngay sau khoảng trắng. */
export function fillBang(text: string, key: string): { text: string; caret: number } {
  const ws = text.search(WS);
  const rest = (ws < 0 ? "" : text.slice(ws)).trimStart();
  const head = `!${key} `;
  return { text: head + rest, caret: head.length };
}

/** `!key input` ⇒ `run`; mọi trường hợp khác (không `!`, `!!…`, `!` trơn, key sai dạng) ⇒ `none`. */
export function classifyBang(text: string): BangClass {
  const s = text.replace(LEADING_WS, "");
  if (!s.startsWith("!") || s.startsWith("!!")) return { kind: "none" };
  const rest = s.slice(1);
  const ws = rest.search(WS);
  const key = (ws < 0 ? rest : rest.slice(0, ws)).toLowerCase();
  if (!PROCESS_KEY_RE.test(key)) return { kind: "none" };
  const input = ws < 0 ? "" : rest.slice(ws).replace(LEADING_WS, "").replace(TRAILING_WS, "");
  return { kind: "run", key, input };
}
