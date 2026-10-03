// ADM-FR-51 · nhóm dòng nhật ký theo ngày địa phương (Hôm nay / Hôm qua / dd/MM/yyyy); thứ tự giữ nguyên.
import type { AuditItem } from "@ai/contracts";

export type DayGroup = { day: string; items: AuditItem[] };

const pad = (n: number) => String(n).padStart(2, "0");
/** `YYYY-MM-DD` theo giờ địa phương. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function groupByDay(items: AuditItem[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const item of items) {
    const day = dayKey(item.at);
    const last = groups[groups.length - 1];
    if (last?.day === day) last.items.push(item);
    else groups.push({ day, items: [item] });
  }
  return groups;
}

/** `today`/`yesterday` hoặc `dd/MM/yyyy`. */
export function dayLabel(day: string, now: Date): "today" | "yesterday" | string {
  const today = dayKey(now.toISOString());
  if (day === today) return "today";
  const prev = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (day === dayKey(prev.toISOString())) return "yesterday";
  const [y, m, d] = day.split("-");
  return `${d}/${m}/${y}`;
}
