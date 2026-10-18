// HUB-FR-144 · PD-R13/R14/R15 · TZ-R04 · plan §4.7 · plan-domain §4.12: giờ địa phương → UTC theo IANA, không thư viện.
// Thuần, lớp 1: chỉ built-in (`Intl`, `Date.UTC`); không đọc đồng hồ (CA-R05) — `now` truyền vào.
import { isCalendarDate } from "../runs/start-inputs.rules";

const DAY_MS = 86_400_000;
const HORIZON_DAYS = 730;

/** Ngày + số ngày (lịch UTC thuần, không giờ). */
export function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterOf(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

function partsOf(instantMs: number, tz: string) {
  const o: Record<string, number> = {};
  for (const p of formatterOf(tz).formatToParts(new Date(instantMs))) {
    if (p.type !== "literal") o[p.type] = Number(p.value);
  }
  return o as {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  };
}

/** Lệch (ms) của `tz` so với UTC tại `instantMs` = giờ tường dựng lại bằng `Date.UTC` − instant. */
function offsetAt(instantMs: number, tz: string): number {
  const p = partsOf(instantMs, tz);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return wall - Math.floor(instantMs / 1000) * 1000;
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** Giờ tường của `instant` ở `tz`: `"YYYY-MM-DD"`, `"HH:MM"`. */
export function wallClockOf(instant: Date, tz: string): { date: string; time: string } {
  const p = partsOf(instant.getTime(), tz);
  return {
    date: `${String(p.year).padStart(4, "0")}-${pad(p.month)}-${pad(p.day)}`,
    time: `${pad(p.hour % 24)}:${pad(p.minute)}`,
  };
}

/** Giờ địa phương (date + "HH:MM") ở `tz` ⇒ instant UTC. Lặp lúc lùi giờ ⇒ lần đầu; rơi vào khe tiến giờ ⇒ offset trước chuyển. */
export function localToUtc(isoDate: string, time: string, tz: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  const g = Date.UTC(y, m - 1, d, hh, mm);
  const o1 = offsetAt(g - DAY_MS, tz);
  const o2 = offsetAt(g + DAY_MS, tz);
  const c1 = g - o1;
  const c2 = g - o2;
  const matches = [c1, c2].filter((c) => {
    const w = wallClockOf(new Date(c), tz);
    return w.date === isoDate && w.time === time;
  });
  return new Date(matches.length > 0 ? Math.min(...matches) : c1);
}

export type WaitDue =
  | { ok: true; dueAt: Date }
  | { ok: false; why: "missing" | "invalid" | "after_expiry" | "beyond_horizon" };

/** base null ⇒ missing; không phải ngày lịch ⇒ invalid; dueAt > expiresAt ⇒ after_expiry; dueAt > now + 730 ngày ⇒ beyond_horizon. */
export function waitDueAt(i: {
  base: string | null;
  offsetDays: number;
  time: string;
  tz: string;
  now: Date;
  expiresAt: Date | null;
}): WaitDue {
  if (i.base === null) return { ok: false, why: "missing" };
  if (!isCalendarDate(i.base)) return { ok: false, why: "invalid" };
  const dueAt = localToUtc(addDaysIso(i.base, i.offsetDays), i.time, i.tz);
  if (i.expiresAt !== null && dueAt.getTime() > i.expiresAt.getTime())
    return { ok: false, why: "after_expiry" };
  if (dueAt.getTime() > i.now.getTime() + HORIZON_DAYS * DAY_MS)
    return { ok: false, why: "beyond_horizon" };
  return { ok: true, dueAt };
}

/** "Đã chờ tới {YYYY-MM-DD HH:MM} ({tz})." (PD-R15). */
export function waitedText(dueAt: Date, tz: string): string {
  const w = wallClockOf(dueAt, tz);
  return `Đã chờ tới ${w.date} ${w.time} (${tz}).`;
}

/** PD-R14 · `use_current`. */
export const WAIT_SKIP_TEXT = "Bỏ chờ theo quyết định.";

/** .md output Hub sinh cho stage chờ (có `## Bàn giao`, P-R03). */
export function waitOutputMd(stageName: string, line: string): string {
  return `# ${stageName}\n\n${line}\n\n## Bàn giao\n${line}\n`;
}
