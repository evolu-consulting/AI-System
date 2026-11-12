// CR-127 · E6 · spec §5.5 · vòng LỊCH chung của Hub (`schedule-sweep`): flow đang bật có trigger theo lịch ⇒ gọi `ScheduledSource` của app
// (đăng ký `flowPortRegistry`, #64) theo trang ⇒ phát `flow_events` với `eventId = <event>:<ref>:<dueKey>:<N>`, facts có `days = N` (R#12);
// bộ điều phối hiện có mở lượt (không thêm đường khởi chạy). Mỗi trang: 1 câu nguồn (+1 câu phòng ở `milestone.due`) + 1 câu phát ⇒ ≤ 4 câu.
// Vòng nền chỉ ở worker (`processLoops`); test gọi `scheduleSweepOnce` với `today`/`now` giả (Luật 4c — không ngủ chờ).
// Route CHỈ dev/test `POST /__test/schedule-sweep {today}` (#63) — không mount khi APP_ENV/NODE_ENV khác development/test.
import type { Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { Env, Hono } from "hono";
import { safeErrorFields } from "../../../lib/errors";
import { startLoop } from "../../../lib/loop";
import { flowPortRegistry, type ScheduledSource } from "../../packs/kit/public";
import {
  isIsoDate,
  SCHEDULED_EVENTS,
  scheduleDaysOf,
  scheduleEventId,
  todayIn,
} from "./schedule.rules";
import { emitScheduled, type ScheduledEmit, scheduledFlows } from "./schedule-sweep.repo";

type Log = { warn(msg: string, f?: Record<string, unknown>): void };
export type ScheduleSweepDeps = {
  db: Db;
  now?: () => Date;
  /** Ghi đè "hôm nay" cho MỌI công ty (route test, int). */
  today?: string;
  batch?: number;
  sourceFor?: (app: string, event: string) => ScheduledSource | undefined;
  log?: Log;
};
export type ScheduleSweepStats = { groups: number; due: number; emitted: number; failed: number };

const SYS = { kind: "system" as const };
export const SCHEDULE_BATCH = 100;
const EVERY_MS = 10 * 60_000;

type Group = { tenantId: string; event: string; days: number; today: string };

async function groupsOf(d: ScheduleSweepDeps, now: Date): Promise<Group[]> {
  const rows = await withHubScope(d.db, SYS, (tx) =>
    scheduledFlows(tx, [...SCHEDULED_EVENTS.keys()]),
  );
  const seen = new Map<string, Group>();
  for (const r of rows) {
    const days = scheduleDaysOf(r.event, { days: r.days });
    if (days === null) continue;
    const today = d.today ?? todayIn(r.timezone, now);
    seen.set(`${r.tenant_id}|${r.event}|${days}`, {
      tenantId: r.tenant_id,
      event: r.event,
      days,
      today,
    });
  }
  return [...seen.values()];
}

/** Một nhóm (công ty × sự kiện × N): đọc nguồn theo trang tới hết, phát mỗi trang một câu. */
async function sweepGroup(d: ScheduleSweepDeps, src: ScheduledSource, g: Group) {
  const limit = d.batch ?? SCHEDULE_BATCH;
  let after: { dueKey: string; ref: string } | null = null;
  let due = 0;
  let emitted = 0;
  for (;;) {
    const page = await src.dueRecords({
      tenantId: g.tenantId,
      event: g.event,
      params: { days: g.days },
      today: g.today,
      limit,
      after,
    });
    due += page.length;
    const rows: ScheduledEmit[] = page.map((p) => ({
      tenant_id: g.tenantId,
      event_id: scheduleEventId(g.event, p.ref, p.dueKey, g.days),
      event: g.event,
      ref: p.ref,
      facts: { ...p.facts, days: g.days },
      actor_id: p.actorId,
      days: g.days,
    }));
    if (rows.length > 0) emitted += await withHubScope(d.db, SYS, (tx) => emitScheduled(tx, rows));
    if (page.length < limit) return { due, emitted };
    const last = page[page.length - 1];
    after = last ? { dueKey: last.dueKey, ref: last.ref } : null;
  }
}

/** Một lượt vòng lịch (test gọi trực tiếp; vòng nền mỗi 10 phút). Lỗi một nhóm ⇒ log, nhóm khác chạy tiếp. */
export async function scheduleSweepOnce(d: ScheduleSweepDeps): Promise<ScheduleSweepStats> {
  const now = (d.now ?? (() => new Date()))();
  const sourceFor = d.sourceFor ?? flowPortRegistry.scheduledSourceFor;
  const stats: ScheduleSweepStats = { groups: 0, due: 0, emitted: 0, failed: 0 };
  for (const g of await groupsOf(d, now)) {
    const app = SCHEDULED_EVENTS.get(g.event)?.app;
    const src = app ? sourceFor(app, g.event) : undefined;
    if (!src) continue; // app chưa cài nguồn (gói tắt) ⇒ bỏ qua
    stats.groups++;
    try {
      const r = await sweepGroup(d, src, g);
      stats.due += r.due;
      stats.emitted += r.emitted;
    } catch (err) {
      stats.failed++;
      d.log?.warn("schedule-sweep-group-failed", {
        tenant_id: g.tenantId,
        event: g.event,
        ...safeErrorFields(err),
      });
    }
  }
  return stats;
}

export function startScheduleSweep(
  d: ScheduleSweepDeps & { log: Log },
  o: { signal?: AbortSignal; everyMs?: number } = {},
): void {
  startLoop({
    name: "schedule-sweep",
    everyMs: o.everyMs ?? EVERY_MS,
    tick: () => scheduleSweepOnce(d),
    log: d.log as never,
    ...(o.signal ? { signal: o.signal } : {}),
  });
}

/** Chỉ development/test (fail-closed: vắng biến môi trường ⇒ coi như production). */
export const scheduleTestRouteOn = (env: string | undefined): boolean =>
  env === "development" || env === "test";

/** #63 · `POST /__test/schedule-sweep {today}` — chạy MỘT lượt vòng lịch với "hôm nay" giả. Trả true khi đã mount. */
export function mountScheduleTestRoute<E extends Env>(
  app: Hono<E>,
  d: ScheduleSweepDeps,
  env: string | undefined = process.env.APP_ENV ?? process.env.NODE_ENV,
): boolean {
  if (!scheduleTestRouteOn(env)) return false;
  app.post("/__test/schedule-sweep", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { today?: unknown };
    if (body.today !== undefined && !isIsoDate(body.today))
      return c.json({ error: { code: "VALIDATION", message: "today phải dạng YYYY-MM-DD" } }, 400);
    const today = body.today as string | undefined;
    return c.json(await scheduleSweepOnce({ ...d, ...(today ? { today } : {}) }));
  });
  return true;
}
