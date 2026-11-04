// CR-115 · cr115-fix · AC-H41 · HUB-FR-105/143/144 · sửa sau review cuối đợt của lô bắn hẹn `retry` + `kickMany`:
// PD-B05 (TB1) savepoint lỗi SAU khi đã đặt `fired_at` (requeue ném) ⇒ fired_at hoàn lại, `fireOne` bắn đúng 1 lần;
// PD-B06 (TB2) một lô 2 tenant × 2 user xen kẽ ⇒ mỗi run đúng scope người bắt đầu, đủ job;
// PD-B07 (TB3) lô không giữ khoá hội thoại rồi chờ khoá run khác (không 40P01 với tx giữ run B rồi cần hội thoại A);
// PD-B08 (Thấp3) COMMIT lô xong nhưng client thấy lỗi ⇒ stage đã có hub run vẫn được launch (có job).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { connectDb, type Db } from "../../../../apps/hub-api/src/lib/db";
import { BATCH_TXS } from "../../../../apps/hub-api/src/modules/processes/runs/launch-common";
import { HUB_API_URL } from "../../H1/_fixtures";
import { fixId, type HubPa } from "../../P-a/_support/pa";
import {
  type CtxPd,
  DEFS,
  handles,
  insertDefPf1,
  type Json,
  needPdSchema,
  P1,
  PA,
  SEC,
  secondHub,
  startPd,
  sweepN,
  T,
  waitFor,
} from "../_support/pd";
import { fireStats, insertDueRetries } from "./_bulk";
import { settle } from "./_wait";

let c: CtxPd;
let h2: HubPa | undefined;
let wrapped: Db | undefined;
beforeAll(async () => {
  c = await startPd();
}, 60_000);
afterAll(async () => {
  await h2?.stop();
  await wrapped?.close();
  await c?.stop();
});

type Who = { id: string; tid: string };

async function seed(who: Who, n: number, def: Json = DEFS.single) {
  const now = c.clk.now();
  return insertDueRetries(c.sql, {
    def: def as never,
    who,
    n,
    dueAt: new Date(now.getTime() - 60 * SEC),
    now,
  });
}

/** Run đã bắn (stage `queued`, hẹn đã bắn) — chỉ còn kick. */
async function seedQueued(who: Who, n: number) {
  await settle(c.sql);
  const r = await seed(who, n);
  await c.sql`update hub.stage_runs set status = 'queued' where id = any(${c.sql.array(r.stageRunIds, 2950)})`;
  await c.sql`update hub.process_timers set fired_at = now() where stage_run_id = any(${c.sql.array(r.stageRunIds, 2950)})`;
  return r;
}

const allJobs = (stageIds: string[], n: number) =>
  waitFor(
    () => fireStats(c.sql, stageIds),
    (s) => s.jobs >= n,
    15_000,
  );

describe("CR-115 · sửa review lô bắn hẹn [AC-H41]", () => {
  it("AC-H41 · PD-B05 · savepoint lỗi sau khi đã đặt fired_at (requeue ném) ⇒ fired_at hoàn lại, không job trùng, fireOne bắn đúng 1 lần", async () => {
    needPdSchema(c.pd);
    await settle(c.sql);
    const ids = await seed(PA.A, 3);
    const bad = ids.stageRunIds[1] as string;
    await c.sql`create sequence if not exists public.qc_cr115_fail_seq`;
    await c.sql`select setval('public.qc_cr115_fail_seq', 1, false)`;
    await c.sql.unsafe(`create or replace function public.qc_cr115_fail() returns trigger
      language plpgsql security definer set search_path = public as $$
      begin
        if new.id = '${bad}'::uuid and new.status = 'queued' and old.status <> 'queued' then
          if nextval('public.qc_cr115_fail_seq') = 1 then raise exception 'qc: requeue lỗi'; end if;
        end if;
        return new;
      end $$`);
    await c.sql`drop trigger if exists qc_cr115_fail on hub.stage_runs`;
    await c.sql`create trigger qc_cr115_fail before update on hub.stage_runs
      for each row execute function public.qc_cr115_fail()`;
    try {
      await sweepN(c, 1);
      const st = await allJobs(ids.stageRunIds, 3);
      expect(st).toEqual({ fired: 3, open: 0, jobs: 3, dupJobs: 0, noJob: 0 });
      // lần 1 (savepoint lô) ném, lần 2 (fireOne) qua — đúng hai lần requeue hàng lỗi.
      const [s] = await c.sql<
        { n: number }[]
      >`select last_value::int as n from public.qc_cr115_fail_seq`;
      expect(s?.n).toBe(2);
    } finally {
      await c.sql`drop trigger if exists qc_cr115_fail on hub.stage_runs`;
    }
  }, 60_000);

  it("AC-H41 · PD-B06 · một lô 2 tenant × 2 user xen kẽ ⇒ mỗi run chạy đúng scope người bắt đầu, 8 job, 0 trùng", async () => {
    needPdSchema(c.pd);
    await settle(c.sql);
    const defB = { ...DEFS.single, id: fixId(), key: "p-single-cr115b" };
    await insertDefPf1(c.sql, defB, { tenantId: T.beta });
    await c.sql`insert into hub.agent_entitlements (agent_id, tenant_id) values (${P1.agRead}, ${T.beta})
      on conflict do nothing`;
    const grants = [
      [T.acme, PA.Adm.id],
      [T.beta, PA.D.id],
      [T.beta, PA.Db.id],
    ] as const;
    for (const [tid, uid] of grants)
      await c.sql`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id)
        values (${P1.agRead}, ${tid}, 'user', ${uid}) on conflict do nothing`;
    await c.sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
    const order: [Who, Json][] = [
      [PA.A, DEFS.single],
      [PA.D, defB],
      [PA.Adm, DEFS.single],
      [PA.Db, defB],
    ];
    const stageIds: string[] = [];
    for (let round = 0; round < 2; round++)
      for (const [who, def] of order) stageIds.push(...(await seed(who, 1, def)).stageRunIds);
    await sweepN(c, 1);
    const st = await allJobs(stageIds, 8);
    expect(st).toEqual({ fired: 8, open: 0, jobs: 8, dupJobs: 0, noJob: 0 });
    const owners = await c.sql<
      { ok: boolean }[]
    >`select (h.user_id = r.started_by and h.tenant_id = r.tenant_id) as ok
      from hub.runs h join hub.stage_runs s on s.id = h.stage_run_id join hub.process_runs r on r.id = s.process_run_id
      where s.id = any(${c.sql.array(stageIds, 2950)})`;
    expect(owners.map((o) => o.ok)).toEqual(Array(8).fill(true));
  }, 60_000);

  it("AC-H41 · PD-B07 · tx khác giữ run B rồi cần hội thoại A (như huỷ/trả lời PF2) ∥ kickMany [A,B] ⇒ không 40P01, mỗi run launch đúng 1 lần", async () => {
    needPdSchema(c.pd);
    const r = await seedQueued(PA.A, 2);
    const [a, b] = [...r.runIds].sort() as [string, string];
    const [ca] = await c.sql<
      { conversation_id: string }[]
    >`select conversation_id from hub.process_runs
      where id = ${a}`;
    let kicked: Promise<void> | undefined;
    await c.sql.begin(async (tx) => {
      // tx này luôn tự kiểm deadlock trước (50 ms < 1 s của Hub) ⇒ nếu có chu trình, CHÍNH nó nhận 40P01 ⇒ test đỏ.
      await tx`set local deadlock_timeout = '50ms'`;
      await tx`select id from hub.process_runs where id = ${b} for update`;
      const [me] = await tx<{ pid: number }[]>`select pg_backend_pid() as pid`;
      kicked = (handles(c).kickMany as (ids: string[]) => Promise<void>)([a, b]);
      // Hub đang chờ khoá run B (lô cũ: giữ A + hội thoại A; lô mới: `kick` lẻ của B sau COMMIT).
      await waitFor(
        () =>
          c.sql<{ n: number }[]>`select count(*)::int as n from pg_stat_activity
            where ${me?.pid as number} = any(pg_blocking_pids(pid))`,
        (x) => (x[0]?.n ?? 0) > 0,
        8_000,
      );
      await tx`update hub.conversations set updated_at = now() where id = ${ca?.conversation_id as string}`;
    });
    await kicked;
    const st = await allJobs(r.stageRunIds, 2);
    expect({ jobs: st.jobs, dupJobs: st.dupJobs, noJob: st.noJob }).toEqual({
      jobs: 2,
      dupJobs: 0,
      noJob: 0,
    });
  }, 60_000);

  it("AC-H41 · PD-B08 · COMMIT lô xong nhưng client nhận lỗi ⇒ stage đã có hub run vẫn launch (job), không hub run trùng", async () => {
    needPdSchema(c.pd);
    const fx = commitThenFail(connectDb(HUB_API_URL, 4));
    wrapped = fx.db;
    h2 = await secondHub(c, {
      now: c.clk.now,
      instanceId: "qc-cr115-fix",
      extraDeps: { db: fx.db },
    });
    const r = await seedQueued(PA.A, 3);
    fx.arm();
    const hd = h2.handles() as Json;
    await (hd.kickMany as (ids: string[]) => Promise<void>)(r.runIds);
    expect(fx.fired()).toBe(1);
    const st = await allJobs(r.stageRunIds, 3);
    expect({ jobs: st.jobs, dupJobs: st.dupJobs, noJob: st.noJob }).toEqual({
      jobs: 3,
      dupJobs: 0,
      noJob: 0,
    });
    const [h] = await c.sql<{ n: number }[]>`select count(*)::int as n from hub.runs
      where stage_run_id = any(${c.sql.array(r.stageRunIds, 2950)})`;
    expect(h?.n).toBe(3);
  }, 60_000);
});

/** Db bọc: tx có savepoint của `kickMany` (`BATCH_TXS`) ⇒ COMMIT thật rồi ném (mất kết nối sau COMMIT) — một lần khi `arm`. */
function commitThenFail(real: Db): { db: Db; arm(): void; fired(): number } {
  let armed = false;
  let fired = 0;
  const drz = real.db as unknown as Record<string | symbol, unknown> & {
    transaction(cb: (tx: Json) => Promise<unknown>, cfg?: unknown): Promise<unknown>;
  };
  const transaction = (cb: (tx: Json) => Promise<unknown>, cfg?: unknown) => {
    let batch = false;
    return drz
      .transaction(async (tx: Json) => {
        const orig = tx.transaction.bind(tx);
        tx.transaction = (f: (sp: object) => Promise<unknown>, c2?: unknown) =>
          orig(async (sp: object) => {
            try {
              return await f(sp);
            } finally {
              if (BATCH_TXS.has(sp)) batch = true;
            }
          }, c2);
        return cb(tx);
      }, cfg)
      .then((out) => {
        if (batch && armed) {
          armed = false;
          fired += 1;
          throw new Error("qc: mất kết nối sau COMMIT");
        }
        return out;
      });
  };
  const bind = (o: object, k: string | symbol) => {
    const v = Reflect.get(o, k);
    return typeof v === "function" ? v.bind(o) : v;
  };
  const dbProxy = new Proxy(drz, {
    get: (o, k) => (k === "transaction" ? transaction : bind(o, k)),
  });
  const db = new Proxy(real, { get: (o, k) => (k === "db" ? dbProxy : bind(o, k)) }) as Db;
  return {
    db,
    arm: () => {
      armed = true;
    },
    fired: () => fired,
  };
}
