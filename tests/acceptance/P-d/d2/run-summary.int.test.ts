// AC-H41 · HUB-FR-144 · D2-45 (#114) · test-plan-d2 §3.4b PD2-I52: `ProcessRunSummary` thêm `wait_until` / `retry_at` = `due_at`
// SỚM NHẤT của hẹn mở (chưa bắn, chưa huỷ) cùng loại của run; không có ⇒ `null`. Hẹn chèn bằng owner SQL (`insertTimer`), đọc
// qua `GET /process-runs` (danh sách) và `GET /process-runs/:id`. Đỏ vì chưa có hai trường (undefined ≠ giá trị/null).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  type CtxPd,
  DAY,
  HOUR,
  type Json,
  needPdSchema,
  PD_DEFS,
  stageOf,
  startPd,
  startRun,
  T,
  viewRun,
} from "../_support/pd";
import { insertTimer } from "../_support/two-tenant";
import { ensureDef } from "../d1/_remind";

let c: CtxPd;
beforeAll(async () => {
  c = await startPd({ processRunsPerTenant: 200 });
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

describe("AC-H41 · D2-45 · RunSummary.wait_until / retry_at", () => {
  it("AC-H41 · PD2-I52 · hẹn mở sớm nhất theo loại; hẹn đã bắn/huỷ bị bỏ; run không hẹn ⇒ null (danh sách + chi tiết)", async () => {
    needPdSchema(c.pd);
    await ensureDef(c, PD_DEFS.remind());
    const t0 = Date.now() + 30 * DAY; // xa hơn mọi hẹn thật; đồng hồ test không chạm
    const at = (ms: number) => new Date(t0 + ms);
    const runs = {
      wait: await startRun(c, "pd-remind"),
      retry: await startRun(c, "pd-remind"),
      both: await startRun(c, "pd-remind"),
      none: await startRun(c, "pd-remind"),
      dead: await startRun(c, "pd-remind"),
    };
    const stage = async (r: string) => (await stageOf(c.sql, r, 0))?.id as string;
    let k = 0;
    const timer = async (r: string, kind: string, dueAt: Date, o: Json = {}) =>
      insertTimer(c.sql, {
        tid: T.acme,
        runId: r,
        stageRunId: await stage(r),
        kind,
        dueAt,
        key: `pd2-i52-${++k}`,
        ...o,
      });
    // wait: 2 hẹn mở (sớm nhất = +2 h) + 1 hẹn huỷ sớm hơn + 1 hẹn đã bắn sớm hơn
    await timer(runs.wait, "wait_until", at(5 * HOUR));
    await timer(runs.wait, "wait_until", at(2 * HOUR));
    await timer(runs.wait, "wait_until", at(HOUR), { cancelledAt: new Date() });
    await timer(runs.wait, "wait_until", at(HOUR / 2), { firedAt: new Date() });
    // retry: 2 hẹn mở (sớm nhất = +3 h)
    await timer(runs.retry, "retry", at(9 * HOUR));
    await timer(runs.retry, "retry", at(3 * HOUR));
    // cả hai loại
    await timer(runs.both, "wait_until", at(7 * HOUR));
    await timer(runs.both, "retry", at(4 * HOUR));
    // chỉ hẹn đã bắn/huỷ ⇒ null
    await timer(runs.dead, "wait_until", at(HOUR), { firedAt: new Date() });
    await timer(runs.dead, "retry", at(HOUR), { cancelledAt: new Date() });

    const iso = (ms: number) => at(ms).toISOString();
    const want: Record<keyof typeof runs, { wait_until: string | null; retry_at: string | null }> =
      {
        wait: { wait_until: iso(2 * HOUR), retry_at: null },
        retry: { wait_until: null, retry_at: iso(3 * HOUR) },
        both: { wait_until: iso(7 * HOUR), retry_at: iso(4 * HOUR) },
        none: { wait_until: null, retry_at: null },
        dead: { wait_until: null, retry_at: null },
      };
    const pick = (s: Json | undefined) => ({ wait_until: s?.wait_until, retry_at: s?.retry_at });
    const norm = (v: { wait_until?: unknown; retry_at?: unknown }) => ({
      wait_until:
        typeof v.wait_until === "string" ? new Date(v.wait_until).toISOString() : v.wait_until,
      retry_at: typeof v.retry_at === "string" ? new Date(v.retry_at).toISOString() : v.retry_at,
    });

    const list = await c.call("Adm", "GET", "/process-runs?scope=tenant&limit=50");
    expect(list.status).toBe(200);
    const items = (list.json?.items ?? []) as Json[];
    for (const [name, id] of Object.entries(runs)) {
      const got = norm(pick(items.find((i) => i.id === id)));
      expect({ name, list: got }).toEqual({ name, list: want[name as keyof typeof runs] });
      const one = await viewRun(c, "Adm", id);
      expect(one.status).toBe(200);
      expect({ name, one: norm(pick(one.json)) }).toEqual({
        name,
        one: want[name as keyof typeof runs],
      });
    }
  }, 60_000);
});
