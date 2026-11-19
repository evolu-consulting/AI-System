// CR-188 · BR-188-5: luật thuần của «Giấy tờ đã ký bằng chữ ký này» — con trỏ trang (created_at, id).
import { SIG_DOCS_PAGE } from "@ai/contracts/pack-contracts";

// UUID chuẩn RFC (cùng luật `z.uuid()` của zod 4) — domain chỉ dùng thư viện lõi (ca-domain-builtin-only).
const UUID_RE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;

export type SigDocCursor = { at: string; id: string };

export const encodeCursor = (c: SigDocCursor): string => `${c.at}|${c.id}`;

/** Con trỏ sai dạng ⇒ null (coi như trang đầu, không lỗi). */
export function decodeCursor(raw: string | undefined): SigDocCursor | null {
  if (!raw) return null;
  const [at, id, extra] = raw.split("|");
  if (!at || !id || extra !== undefined) return null;
  if (!UUID_RE.test(id) || Number.isNaN(Date.parse(at))) return null;
  return { at: new Date(at).toISOString(), id };
}

/** Lấy thừa một dòng để biết còn trang sau; cắt về `SIG_DOCS_PAGE`. */
export function pageOf<T extends { signed_at: string; version_id: string }>(
  rows: readonly T[],
): { items: T[]; next: string | null } {
  const items = rows.slice(0, SIG_DOCS_PAGE);
  const last = items[items.length - 1];
  const more = rows.length > SIG_DOCS_PAGE && last !== undefined;
  return { items, next: more ? encodeCursor({ at: last.signed_at, id: last.version_id }) : null };
}
