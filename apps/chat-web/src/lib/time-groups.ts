// CHAT-AC-19 · nhóm hội thoại theo `updated_at` (giờ địa phương): Hôm nay · 7 ngày qua · 30 ngày qua · Cũ hơn.
export type TimeGroup = "today" | "week" | "month" | "older";

export const TIME_GROUP_ORDER: readonly TimeGroup[] = ["today", "week", "month", "older"];

const DAY_MS = 86_400_000;

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Hôm nay = cùng ngày lịch; 7 ngày qua = trong 7 ngày lịch gần nhất (không gồm hôm nay); 30 ngày qua tương tự. */
export function timeGroupOf(iso: string, nowMs: number): TimeGroup {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "older";
  const today = startOfDay(nowMs);
  if (t >= today) return "today";
  if (t >= today - 7 * DAY_MS) return "week";
  if (t >= today - 30 * DAY_MS) return "month";
  return "older";
}

export type Grouped<T> = { group: TimeGroup; items: T[] };

/** Giữ thứ tự đầu vào trong từng nhóm; bỏ nhóm rỗng. */
export function groupByTime<T extends { updated_at: string }>(
  items: readonly T[],
  nowMs: number,
): Grouped<T>[] {
  const buckets = new Map<TimeGroup, T[]>();
  for (const it of items) {
    const g = timeGroupOf(it.updated_at, nowMs);
    const arr = buckets.get(g);
    if (arr) arr.push(it);
    else buckets.set(g, [it]);
  }
  return TIME_GROUP_ORDER.flatMap((group) => {
    const list = buckets.get(group);
    return list ? [{ group, items: list }] : [];
  });
}
