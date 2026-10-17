// AC-H46 · CA-R06 · K1/K2 · T6b/T6c · test-plan-int §7 (PD-I73…PD-I78): UnitOfWork dưới RLS — `loadAdapter("hub-uow.ts")`
// `createHubUow(db, {clock, publish})` (plan §3, plan-addendum A7 Q4 + A8 #65): repo gắn tenant của UoW, lọc tenant tường
// minh kể cả scope system, outbox phát SAU COMMIT đúng 1 lần (rollback ⇒ 0; 40P01 chạy lại ⇒ chỉ sự kiện lần thành công).
// Module chưa có ⇒ đỏ "module vắng". Fixture 0036 chỉ chèn sau `needPdSchema`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { loadAdapter } from "../_support/modules";
import { type CtxPd, DAY, type Json, needPdSchema, PA, startPd, T, waitFor } from "../_support/pd";
import { quiesceDue, type Side, seedTwoTenant } from "../_support/two-tenant";

let c: CtxPd;
beforeAll(async () => {
  c = await startPd();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

type Uow = {
  tenant: <R>(who: { tenantId: string; userId: string }, fn: (r: Json) => Promise<R>) => Promise<R>;
  system: <R>(tenantId: string, fn: (r: Json) => Promise<R>) => Promise<R>;
};
/** UoW thật trên `db` của hub (role hub_api) + `publish` giả ghi mảng (Q4). */
async function makeUow(onPublish?: (events: readonly Json[]) => Promise<void>) {
  const published: Json[][] = [];
  const mod = await loadAdapter("hub-uow.ts");
  const create = mod.createHubUow;
  expect({ createHubUow: typeof create }).toEqual({ createHubUow: "function" });
  const uow = create(c.hub.db, {
    clock: { now: () => c.clk.now() },
    publish: async (events: readonly Json[]) => {
      published.push([...events]);
      await onPublish?.(events);
    },
  }) as Uow;
  return { uow, published };
}
/** Hai tenant có hẹn tới hạn XA (vòng nền không chạm). */
async function seedFar(): Promise<{ acme: Side; beta: Side }> {
  await quiesceDue(c);
  const far = new Date(c.clk.now().getTime() + 3 * DAY);
  return seedTwoTenant(c, { acmeDue: far, betaDue: far });
}
const timerRow = async (id: string) =>
  (await c.sql<Json[]>`select fired_at, cancelled_at from hub.process_timers where id = ${id}`)[0];
const firedOf = (row: Json) => row?.fired_at ?? row?.firedAt ?? null;
const cancelledOf = (row: Json) => row?.cancelled_at ?? row?.cancelledAt ?? null;
const deadlock = () => Object.assign(new Error("deadlock"), { code: "40P01" });

describe("CA-R06 · K1 · UnitOfWork cách ly tenant", () => {
  it("AC-H46 · K1 · PD-I73 · uow.tenant(beta, an): runs.lock(run acme) ⇒ null; timers.lockById(hẹn acme) ⇒ không hàng", async () => {
    needPdSchema(c.pd);
    const s = await seedFar();
    const { uow } = await makeUow();
    const who = { tenantId: T.beta, userId: PA.D.id };
    const run = await uow.tenant(who, (r) => r.runs.lock(s.acme.retry.runId));
    const timer = await uow.tenant(who, (r) => r.timers.lockById(s.acme.retry.timerId));
    expect({ run: run ?? null, timer: timer ?? null }).toEqual({ run: null, timer: null });
    const sysRun = await uow.system(T.beta, (r) => r.runs.lock(s.acme.wait.runId));
    expect({ systemBetaLockAcme: sysRun ?? null }).toEqual({ systemBetaLockAcme: null });
  }, 60_000);

  it("AC-H46 · K3 · PD-I74 · uow.system(beta).timers.cancelForRun(run acme, 'all', now) ⇒ 0 hàng acme đổi", async () => {
    needPdSchema(c.pd);
    const s = await seedFar();
    const { uow } = await makeUow();
    await uow.system(T.beta, (r) => r.timers.cancelForRun(s.acme.retry.runId, "all", c.clk.now()));
    const row = await timerRow(s.acme.retry.timerId);
    expect({ cancelled: cancelledOf(row), fired: firedOf(row) }).toEqual({
      cancelled: null,
      fired: null,
    });
  }, 60_000);

  it("AC-H46 · K1 · PD-I77 · r.tenantId trong uow.system(acme) = acme; cancelForRun không nhận tham số tenant", async () => {
    needPdSchema(c.pd);
    const { uow } = await makeUow();
    const seen = await uow.system(T.acme, async (r) => ({
      tenantId: r.tenantId,
      arity: r.timers.cancelForRun.length,
    }));
    expect(seen.tenantId).toBe(T.acme);
    expect({ arityAtMost3: seen.arity <= 3 }).toEqual({ arityAtMost3: true });
  }, 60_000);
});

describe("CA-R06 · K1 · outbox sau COMMIT (Q4)", () => {
  it("AC-H46 · Q4 · PD-I75 · emit rồi ném ⇒ rollback, publish 0 lần; 40P01 lần 1 ⇒ chạy lại, publish chỉ sự kiện lần 2", async () => {
    needPdSchema(c.pd);
    const s = await seedFar();
    const { uow, published } = await makeUow();
    const runId = s.acme.retry.runId;
    const boom = uow.system(T.acme, async (r) => {
      r.outbox.emit({ kind: "kick", runId });
      await r.timers.cancelForRun(runId, "all", c.clk.now());
      throw new Error("lỗi nghiệp vụ");
    });
    expect(
      await boom.then(
        () => "ok",
        (e: Error) => e.message,
      ),
    ).toBe("lỗi nghiệp vụ");
    expect({
      published: published.length,
      cancelled: cancelledOf(await timerRow(s.acme.retry.timerId)),
    }).toEqual({
      published: 0,
      cancelled: null,
    });
    let n = 0;
    await uow.system(T.acme, async (r) => {
      n += 1;
      if (n === 1) {
        r.outbox.emit({ kind: "kick", runId });
        throw deadlock();
      }
      r.outbox.emit({ kind: "post_thread", runId });
    });
    expect({ attempts: n, published }).toEqual({
      attempts: 2,
      published: [[{ kind: "post_thread", runId }]],
    });
  }, 60_000);

  it("AC-H46 · Q4 · PD-I76 · uow.system(acme) emit thành công ⇒ publish đúng 1 lần [{kick}], SAU COMMIT (lúc publish đã đọc thấy hàng ghi)", async () => {
    needPdSchema(c.pd);
    const s = await seedFar();
    const seenAtPublish: Json[] = [];
    const { uow, published } = await makeUow(async () => {
      seenAtPublish.push(cancelledOf(await timerRow(s.acme.wait.timerId)) !== null);
    });
    const runId = s.acme.wait.runId;
    await uow.system(T.acme, async (r) => {
      await r.timers.cancelForRun(runId, "all", c.clk.now());
      r.outbox.emit({ kind: "kick", runId });
    });
    expect({ published, seenAtPublish }).toEqual({
      published: [[{ kind: "kick", runId }]],
      seenAtPublish: [true],
    });
  }, 60_000);
});

describe("CA-R06 · K1 · khoá run → timer", () => {
  it("AC-H46 · PD-I78 · 2 tx song song cùng run (uow.system) bắn 1 hẹn ⇒ đúng 1 lần (tx 2 chờ khoá run, đọc lại thấy fired_at)", async () => {
    needPdSchema(c.pd);
    const s = await seedFar();
    const { uow } = await makeUow();
    const { runId, timerId } = s.acme.retry;
    let release: () => void = () => {};
    const gate = new Promise<void>((res) => {
      release = res;
    });
    let fires = 0;
    const fire = (hold: boolean) =>
      uow.system(T.acme, async (r) => {
        await r.runs.lock(runId);
        const t = await r.timers.lockById(timerId);
        if (hold) await gate;
        if (t && firedOf(t) === null && cancelledOf(t) === null) {
          fires += 1;
          await r.timers.markFired(timerId, c.clk.now());
        }
      });
    const first = fire(true);
    // Chờ tx 1 giữ khoá run (theo điều kiện, không sleep), rồi mở tx 2 — nó phải chờ khoá.
    await waitFor(
      () => c.sql<
        { n: number }[]
      >`select count(*)::int as n from pg_locks l join pg_class k on k.oid = l.relation
        where k.relname = 'process_runs' and l.mode = 'RowShareLock' and l.granted`,
      (v) => (v[0]?.n ?? 0) > 0,
      5_000,
    );
    const second = fire(false);
    await waitFor(
      () => c.sql<{ n: number }[]>`select count(*)::int as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'`,
      (v) => (v[0]?.n ?? 0) > 0,
      5_000,
    );
    release();
    await Promise.all([first, second]);
    expect({ fires, fired: firedOf(await timerRow(timerId)) !== null }).toEqual({
      fires: 1,
      fired: true,
    });
  }, 60_000);
});
