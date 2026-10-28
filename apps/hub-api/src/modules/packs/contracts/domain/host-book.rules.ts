// com-c8-host-read · ADR-0031 · khớp tên SP cho cổng đọc sổ chủ quản: id ⇒ khớp đúng; tên ⇒ khớp đúng khoá (`name_key` = fold) rồi
// khớp TIỀN TỐ (ngắn nhất thắng, hoà thì theo khoá). Không AI. Thuần — chỉ built-in + `foldVi` (≡ SQL `contracts.fold`).
import { foldVi } from "./fold.rules";

export type HostHint = { productId?: string; name?: string };
export type HostCandidate = { id: string; name: string; nameKey: string };
export type HostMatchHow = "id" | "exact" | "prefix";

export const HOST_BATCH_MAX = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (s: string): boolean => UUID.test(s);

/** Khoá tên của gợi ý (rỗng ⇒ không khớp tên được). */
export const hintKey = (h: HostHint): string => foldVi(h.name ?? "");

/** Chọn SP cho một gợi ý trong số ứng viên đã lọc theo tenant. null = không khớp. */
export function pickMatch<C extends HostCandidate>(
  h: HostHint,
  cands: readonly C[],
): { product: C; how: HostMatchHow } | null {
  if (h.productId) {
    const id = h.productId.toLowerCase();
    const hit = cands.find((c) => c.id.toLowerCase() === id);
    return hit ? { product: hit, how: "id" } : null;
  }
  const key = hintKey(h);
  if (key === "") return null;
  const exact = cands.find((c) => c.nameKey === key);
  if (exact) return { product: exact, how: "exact" };
  const pre = cands
    .filter((c) => c.nameKey.startsWith(key))
    .sort((a, b) => a.nameKey.length - b.nameKey.length || (a.nameKey < b.nameKey ? -1 : 1))[0];
  return pre ? { product: pre, how: "prefix" } : null;
}
