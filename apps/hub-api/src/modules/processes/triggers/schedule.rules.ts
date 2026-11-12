// CR-127 · E6 · spec §5.5 (R#12) · luật THUẦN của trigger theo lịch: N của quy trình (`trigger.params.days`, vắng ⇒ mặc định manifest),
// khoá idempotent `<event>:<ref>:<dueKey>:<N>`, ngày hôm nay theo múi giờ công ty.
import { APP_MANIFESTS } from "@ai/contracts/app-manifest";

type Sched = { app: string; min: number; max: number; def: number };

/** Sự kiện theo lịch → app + khoảng N (một nguồn: `AppEventDecl.schedule`). */
export const SCHEDULED_EVENTS: ReadonlyMap<string, Sched> = new Map(
  Object.values(APP_MANIFESTS).flatMap((m) =>
    m.events
      .filter((e) => e.schedule)
      .map((e) => {
        const p = e.schedule?.param as { min: number; max: number; default: number };
        return [e.key, { app: m.key, min: p.min, max: p.max, def: p.default }] as const;
      }),
  ),
);

/** N hiệu lực của flow cho sự kiện; sự kiện không theo lịch ⇒ null; N ngoài khoảng manifest ⇒ null (không phát). */
export function scheduleDaysOf(event: string, params: unknown): number | null {
  const s = SCHEDULED_EVENTS.get(event);
  if (!s) return null;
  const raw = (params as { days?: unknown } | null | undefined)?.days;
  const n = raw === undefined || raw === null ? s.def : Number(raw);
  return Number.isInteger(n) && n >= s.min && n <= s.max ? n : null;
}

/** Khoá idempotent (≤ 200 ký tự — `flow_events_event_id_ck`). */
export const scheduleEventId = (event: string, ref: string, dueKey: string, days: number) =>
  `${event}:${ref}:${dueKey}:${days}`;

/** `YYYY-MM-DD` của `now` theo múi giờ (sai múi ⇒ UTC). */
export function todayIn(tz: string | null | undefined, now: Date): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** R#12 · flow lịch chỉ khớp sự kiện có `facts.days` = N của flow (dữ kiện không có `days` — vd hỏi "có quy trình?" — không lọc). */
export function scheduleDaysMatch(flowDays: number | null | undefined, factDays: unknown): boolean {
  if (flowDays === null || flowDays === undefined) return true;
  if (typeof factDays !== "number") return true;
  return factDays === flowDays;
}

export const isIsoDate = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/** CR-127 · E6b · luật lưu: `trigger.params.days` có mà ngoài khoảng manifest của sự kiện theo lịch ⇒ lỗi (422 `TRIGGER_PARAM_RANGE`);
 *  vắng ⇒ dùng mặc định (hợp lệ); sự kiện không theo lịch ⇒ bỏ qua (zod đã chặn 1..365). */
export function triggerParamIssue(
  trigger: { event: string; params?: { days?: unknown } | null } | null | undefined,
): { path: string[]; min: number; max: number } | null {
  const s = trigger ? SCHEDULED_EVENTS.get(trigger.event) : undefined;
  const raw = trigger?.params?.days;
  if (!s || raw === undefined || raw === null) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= s.min && n <= s.max
    ? null
    : { path: ["trigger", "params", "days"], min: s.min, max: s.max };
}
