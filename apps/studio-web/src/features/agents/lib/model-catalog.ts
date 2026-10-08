// CR-054 · phân nhóm danh mục model (Runtime đọc từ Claude CLI) cho ô Model của bước ②.
import type { ModelCatalogItem } from "@ai/contracts/studio";

/** Alias trỏ bản mới nhất của dòng model (CLI tự nâng cấp). */
export const MODEL_ALIASES: readonly string[] = ["default", "opus", "sonnet", "haiku"];

export type ModelGroups = { latest: ModelCatalogItem[]; pinned: ModelCatalogItem[] };

/** "Luôn bản mới nhất" (alias, giữ thứ tự CLI) trên, "Bản cố định" dưới; trùng `value` chỉ giữ mục đầu. */
export function groupModels(items: readonly ModelCatalogItem[]): ModelGroups {
  const seen = new Set<string>();
  const latest: ModelCatalogItem[] = [];
  const pinned: ModelCatalogItem[] = [];
  for (const m of items) {
    if (seen.has(m.value)) continue;
    seen.add(m.value);
    (MODEL_ALIASES.includes(m.value) ? latest : pinned).push(m);
  }
  return { latest, pinned };
}

/** `fetched_at` mới nhất của danh mục (null khi rỗng). */
export function latestFetchedAt(items: readonly ModelCatalogItem[]): string | null {
  let best: string | null = null;
  for (const m of items) if (best === null || m.fetched_at > best) best = m.fetched_at;
  return best;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO → "HH:MM dd/MM/yyyy" giờ trình duyệt; không đọc được → "". */
export function formatFetchedAt(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const date = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  return `${pad(d.getHours())}:${pad(d.getMinutes())} ${date}`;
}
