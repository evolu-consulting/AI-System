// CR-114 · hub-agent-handoff · nén lịch sử hội thoại dài của Orchestrator. Thuần: lượt cũ → MỘT mục tóm tắt (mỗi lượt một
// dòng ngắn) + khoá artifact giữ nguyên văn các lượt đó; N lượt cuối giữ nguyên văn.
import type { HistoryItem } from "@ai/contracts/hub";

export const KEEP_LAST_TURNS = 6;
/** Mỗi lượt cũ còn ≤ chừng này ký tự trong tóm tắt. */
export const SUMMARY_LINE_MAX = 120;
/** Mục tóm tắt ≤ `HISTORY_ITEM_MAX` của prompt Orchestrator (dòng đầu luôn giữ khoá artifact). */
export const SUMMARY_MAX = 4000;

export type Compaction = {
  /** Lịch sử để dựng prompt: [tóm tắt?, …N lượt cuối]. */
  history: HistoryItem[];
  /** Nguyên văn các lượt cũ (để lưu artifact); rỗng ⇒ không nén. */
  older: HistoryItem[];
};

const line = (h: HistoryItem): string => {
  const one = h.content.replace(/\s+/g, " ").trim();
  const pts = [...one];
  const cut =
    pts.length <= SUMMARY_LINE_MAX ? one : `${pts.slice(0, SUMMARY_LINE_MAX - 1).join("")}…`;
  return `${h.role}: ${cut}`;
};

/** Tách lượt cũ / N lượt cuối. `keep` ≥ 1; lịch sử ≤ keep ⇒ giữ nguyên (không có `older`). */
export function splitHistory(items: readonly HistoryItem[], keep = KEEP_LAST_TURNS): Compaction {
  const k = Math.max(1, Math.trunc(keep));
  if (items.length <= k) return { history: [...items], older: [] };
  return { history: items.slice(-k), older: items.slice(0, items.length - k) };
}

/** Văn bản lưu artifact cho các lượt cũ (JSON lines — agent đọc lại bằng `artifact.get`). */
export const olderBody = (older: readonly HistoryItem[]): string =>
  older.map((h) => JSON.stringify({ role: h.role, content: h.content })).join("\n");

/**
 * Lịch sử đã nén: mục đầu (role `assistant`) = tóm tắt từng lượt cũ + khoá artifact (vắng ⇒ không lưu được, chỉ tóm tắt);
 * sau đó N lượt cuối nguyên văn.
 */
export function compactHistory(
  items: readonly HistoryItem[],
  o: { keep?: number; ref?: string | null } = {},
): HistoryItem[] {
  const { history, older } = splitHistory(items, o.keep);
  if (older.length === 0) return history;
  const head = `[${older.length} earlier turns${o.ref ? ` · full text: ${o.ref}` : ""}]`;
  const content = [...[head, ...older.map(line)].join("\n")];
  const summary: HistoryItem = {
    role: "assistant",
    content:
      content.length <= SUMMARY_MAX ? content.join("") : content.slice(0, SUMMARY_MAX).join(""),
  };
  return [summary, ...history];
}
