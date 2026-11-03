// CR-116 · bench hub (CHỈ ĐO, không đổi hành vi) phần 2: B3 người nhận theo run (N+1 hàm definer vs một câu theo tập vs
// pipeline vs Bun.sql), B4 bắn hẹn giờ (4 câu/hẹn vs một câu CTE theo tập) + độ tin cậy (2 Hub SKIP LOCKED, giết kết nối giữa
// tx), B6 đếm chưa đọc (count index một phần vs bảng đếm). Bản sao bảng trong schema `bench` (xem _seed.ts). Chỉ PERF=1.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { SQL } from "bun";
import postgres from "postgres";
import { ab, explain } from "./_ab";
import { cloneTable, fill, uid, uidSql } from "./_seed";

const PERF = process.env.PERF === "1";
const T = uid(0x7e, 1);
let sql: Sql;
let bun: SQL;

beforeAll(async () => {
  if (!PERF) return;
  await cloneDb("full");
  sql = openOwner(4);
  bun = new SQL(urls().owner, { max: 1 });
}, 300_000);
afterAll(async () => {
  await sql?.end();
  await bun?.close();
});

// ---------------- B3 · hub.process_run_recipients mỗi run (pgss #10: 3.424 lần) ----------------
async function seedB3(n: number): Promise<void> {
  const map: [string, string][] = [
    ["hub.process_runs", "rr_runs"],
    ["hub.room_members", "rr_rm"],
    ["hub.review_task_assignees", "rr_rta"],
    ["hub.review_tasks", "rr_rt"],
    ["admin.group_members", "rr_gm"],
  ];
  for (const [src, name] of map) await cloneTable(sql, src, name);
  await fill(sql, "rr_runs", n, {
    id: uidSql(0xc3),
    tenant_id: `'${T}'::uuid`,
    status: "'running'",
    started_by: uidSql(0xc0, "(i % 50) + 1"),
    origin_kind: "case when i % 4 = 0 then 'room' else 'none' end",
    origin_room_id: `case when i % 4 = 0 then ${uidSql(0xc4, "(i % 20) + 1")} else null end`,
    flow_id: "gen_random_uuid()",
  });
  await fill(sql, "rr_rm", 100, {
    room_id: uidSql(0xc4, "(i % 20) + 1"),
    tenant_id: `'${T}'::uuid`,
    user_id: uidSql(0xc0, "300 + i"),
    left_at: "case when i % 10 = 0 then now() else null end",
  });
  await fill(sql, "rr_rt", n, {
    id: uidSql(0xc6),
    tenant_id: `'${T}'::uuid`,
    process_run_id: uidSql(0xc3),
    stage_run_id: "gen_random_uuid()",
    kind: "'review'",
    status: "case when i % 2 = 0 then 'open' else 'done' end",
    assignee_group_id: uidSql(0xc5, "(i % 10) + 1"),
  });
  await fill(sql, "rr_rta", n, {
    task_id: uidSql(0xc6),
    tenant_id: `'${T}'::uuid`,
    user_id: uidSql(0xc0, "100 + (i % 50)"),
  });
  await fill(sql, "rr_gm", 40, {
    group_id: uidSql(0xc5, "(i % 10) + 1"),
    tenant_id: `'${T}'::uuid`,
    user_id: uidSql(0xc0, "200 + i"),
  });
  const [d] =
    await sql`select pg_get_functiondef('hub.process_run_recipients(uuid,uuid)'::regprocedure) as f`;
  let f = String(d?.f).replace("hub.process_run_recipients", "bench.process_run_recipients");
  for (const [src, name] of map) f = f.replaceAll(`${src} `, `bench.${name} `);
  await sql.unsafe(f);
}

const RECIP_SET = `select r.id::text as run, u.uid::text as uid from bench.rr_runs r cross join lateral (
    select r.started_by as uid where r.started_by is not null
    union select m.user_id from bench.rr_rm m where r.origin_kind = 'room' and r.origin_room_id is not null
      and m.room_id = r.origin_room_id and m.tenant_id = r.tenant_id and m.left_at is null
    union select a.user_id from bench.rr_rta a join bench.rr_rt t on t.id = a.task_id and t.tenant_id = a.tenant_id
      where t.process_run_id = r.id and t.tenant_id = r.tenant_id and t.status = 'open' and a.user_id is not null
    union select gm.user_id from bench.rr_rt t join bench.rr_gm gm on gm.group_id = t.assignee_group_id and gm.tenant_id = r.tenant_id
      where t.process_run_id = r.id and t.tenant_id = r.tenant_id and t.status = 'open' and t.assignee_group_id is not null) u
  where r.id = any($1::uuid[]) and r.tenant_id = $2
    and (current_setting('app.scope', true) = 'system' or (current_setting('app.scope', true) = 'user'
      and nullif(current_setting('app.tenant_id', true), '')::uuid = r.tenant_id))`;
const ONE = "select uid::text from bench.process_run_recipients($1::uuid, $2::uuid)";
type Rec = Record<string, string[]>;
const canonRec = (m: Rec) =>
  Object.keys(m)
    .sort()
    .map((k) => [k, [...new Set(m[k])].sort()]);

describe.skipIf(!PERF)("B3 · người nhận process_updated cho lô 100 run", () => {
  for (const n of [100, 10_000])
    it(`B3 · ${n} run`, async () => {
      await seedB3(n);
      const batch = (i: number) =>
        Array.from({ length: 100 }, (_, k) => uid(0xc3, ((Math.abs(i) * 100 + k) % n) + 1));
      const sys = async <R>(s: Sql, fn: (tx: Sql) => Promise<R>) =>
        s.begin(async (tx) => {
          await tx`select set_config('app.scope', 'system', true)`;
          return fn(tx as unknown as Sql);
        }) as Promise<R>;
      const perRow = (pipelined: boolean) => (s: Sql, i: number) =>
        sys(s, async (tx) => {
          const out: Rec = {};
          const one = async (id: string) => {
            out[id] = ((await tx.unsafe(ONE, [id, T])) as unknown as { uid: string }[]).map(
              (r) => r.uid,
            );
          };
          if (pipelined) await Promise.all(batch(i).map(one));
          else for (const id of batch(i)) await one(id);
          return out;
        });
      const rows = await ab(sql, {
        cand: "B3 recipients",
        rows: n,
        canon: canonRec as (r: unknown) => unknown,
        variants: [
          { name: "hiện tại: hàm definer × 100 (tuần tự)", run: perRow(false) },
          { name: "hàm × 100 pipeline postgres.js (Promise.all)", run: perRow(true) },
          {
            name: "1 câu theo tập (lateral, = any)",
            run: (s, i) =>
              sys(s, async (tx) => {
                const out: Rec = Object.fromEntries(batch(i).map((id) => [id, [] as string[]]));
                for (const r of (await tx.unsafe(RECIP_SET, [batch(i), T])) as unknown as {
                  run: string;
                  uid: string;
                }[])
                  (out[r.run] as string[]).push(r.uid);
                return out;
              }),
          },
          {
            name: "hàm × 100 tuần tự qua Bun.sql native",
            run: (_s, i) =>
              bun.begin(async (tx) => {
                await tx`select set_config('app.scope', 'system', true)`;
                const out: Rec = {};
                for (const id of batch(i))
                  out[id] = ((await tx.unsafe(ONE, [id, T])) as { uid: string }[]).map(
                    (r) => r.uid,
                  );
                return out;
              }) as Promise<Rec>,
          },
        ],
        n: 30,
      });
      expect(rows.every((r) => r.equal)).toBe(true);
    }, 600_000);
});

// ---------------- B4 · bắn hẹn giờ lô 100 (pgss #30/#31/#34/#32: 4 câu × 2.000 hẹn) ----------------
async function seedB4(n: number): Promise<void> {
  await cloneTable(sql, "hub.process_timers", "tm");
  await cloneTable(sql, "hub.stage_runs", "sr");
  await fill(sql, "tm", n, {
    id: uidSql(0xd1),
    tenant_id: `'${T}'::uuid`,
    process_run_id: uidSql(0xd2),
    stage_run_id: uidSql(0xd3),
    kind: "'retry'",
    due_at: "now() - interval '1 hour' + i * interval '1 ms'",
    idempotency_key: "'k' || i",
  });
  await fill(sql, "sr", n, {
    id: uidSql(0xd3),
    tenant_id: `'${T}'::uuid`,
    process_run_id: uidSql(0xd2),
    stage_idx: "0",
    status: "'waiting_timer'",
  });
}
type Tm = { id: string; tenant_id: string; process_run_id: string; stage_run_id: string };
const tmOf = (i: number): Tm => ({
  id: uid(0xd1, i),
  tenant_id: T,
  process_run_id: uid(0xd2, i),
  stage_run_id: uid(0xd3, i),
});
const NOW = new Date().toISOString();
async function fireRow(tx: Sql, t: Tm): Promise<boolean> {
  const [tm] = await tx.unsafe(
    "select id, fired_at, cancelled_at from bench.tm where id = $1 and tenant_id = $2 for update",
    [t.id, t.tenant_id],
  );
  if (!tm || tm.fired_at || tm.cancelled_at) return false;
  await tx.unsafe(
    "select id, status from bench.sr where id = $1 and process_run_id = $2 and tenant_id = $3 for update",
    [t.stage_run_id, t.process_run_id, t.tenant_id],
  );
  const u = await tx.unsafe(
    "update bench.tm set fired_at = $1::timestamptz where id = $2 and tenant_id = $3 and fired_at is null and cancelled_at is null returning 1",
    [NOW, t.id, t.tenant_id],
  );
  await tx.unsafe(
    "update bench.sr set status = 'queued', current_run_id = null, updated_at = $1::timestamptz where id = $2 and process_run_id = $3 and tenant_id = $4",
    [NOW, t.stage_run_id, t.process_run_id, t.tenant_id],
  );
  return u.length === 1;
}
const FIRE_SET = `with x as (select * from jsonb_to_recordset($1::text::jsonb) as x(id uuid, tenant_id uuid, process_run_id uuid, stage_run_id uuid)),
  l as (select t.id, t.tenant_id, t.process_run_id, t.stage_run_id from bench.tm t join x on x.id = t.id and x.tenant_id = t.tenant_id
    where t.fired_at is null and t.cancelled_at is null order by t.id for update of t),
  s as (update bench.sr s set status = 'queued', current_run_id = null, updated_at = $2::timestamptz from l
    where s.id = l.stage_run_id and s.process_run_id = l.process_run_id and s.tenant_id = l.tenant_id returning s.id),
  f as (update bench.tm t set fired_at = $2::timestamptz from l where t.id = l.id and t.tenant_id = l.tenant_id returning t.id)
  select array(select id::text from f order by id) as fired, (select count(*)::int from s) as stages`;
const fireSet = async (tx: Sql, ts: Tm[]): Promise<string[]> =>
  ((await tx.unsafe(FIRE_SET, [JSON.stringify(ts), NOW]))[0]?.fired as string[]) ?? [];
const resetB4 = (s: Sql) =>
  s.unsafe(
    "with a as (update bench.tm set fired_at = null where fired_at is not null returning 1) update bench.sr set status = 'waiting_timer' where status <> 'waiting_timer'",
  ) as unknown as Promise<void>;

describe.skipIf(!PERF)("B4 · bắn lô 100 hẹn: 4 câu/hẹn vs CTE theo tập", () => {
  for (const n of [100, 10_000])
    it(`B4 · ${n} hẹn`, async () => {
      await seedB4(n);
      const batch = (i: number) =>
        Array.from({ length: 100 }, (_, k) => tmOf(((Math.abs(i) * 100 + k) % n) + 1));
      const perRow = (pipelined: boolean) => (s: Sql, i: number) =>
        // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: khung bench (chỉ đo)
        s.begin(async (tx) => {
          const ts = batch(i);
          const ok = pipelined
            ? await Promise.all(ts.map((t) => fireRow(tx as unknown as Sql, t)))
            : ([] as boolean[]);
          if (!pipelined) for (const t of ts) ok.push(await fireRow(tx as unknown as Sql, t));
          return ts
            .filter((_t, k) => ok[k])
            .map((t) => t.id)
            .sort();
        }) as Promise<string[]>;
      const rows = await ab(sql, {
        cand: "B4 bắn hẹn lô 100",
        rows: n,
        reset: resetB4,
        variants: [
          { name: "hiện tại: 4 câu/hẹn tuần tự trong 1 tx", run: perRow(false) },
          { name: "4 câu/hẹn pipeline (Promise.all) trong 1 tx", run: perRow(true) },
          {
            name: "1 câu CTE theo tập (jsonb_to_recordset)",
            run: (s, i) =>
              s.begin((tx) => fireSet(tx as unknown as Sql, batch(i))) as Promise<string[]>,
          },
        ],
        n: 30,
      });
      if (n > 1000) {
        await resetB4(sql);
        const lit = FIRE_SET.replace(
          "$1::jsonb",
          `'${JSON.stringify(batch(3))}'::jsonb`,
        ).replaceAll("$2::timestamptz", `'${NOW}'::timestamptz`);
        await explain(sql, "B4", "CTE theo tập", lit);
      }
      expect(rows.every((r) => r.equal)).toBe(true);
    }, 600_000);

  it("B4 · độ tin cậy: 2 Hub SKIP LOCKED cùng lúc + giết kết nối giữa tx", async () => {
    await seedB4(400);
    const claim = (tx: Sql) =>
      tx.unsafe(`select id::text, tenant_id::text, process_run_id::text, stage_run_id::text from bench.tm
        where fired_at is null and cancelled_at is null and due_at <= now() order by due_at limit 100 for update skip locked`) as unknown as Promise<
        Tm[]
      >;
    for (const mode of ["per-row", "set"] as const) {
      await resetB4(sql);
      const hubs = [0, 1].map(() => postgres(urls().owner, { max: 1, onnotice: () => {} }));
      const fired = await Promise.all(
        hubs.map(
          (h) =>
            // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: khung bench (chỉ đo)
            h.begin(async (tx) => {
              const ts = await claim(tx as unknown as Sql);
              if (mode === "set") return fireSet(tx as unknown as Sql, ts);
              const out: string[] = [];
              for (const t of ts) if (await fireRow(tx as unknown as Sql, t)) out.push(t.id);
              return out;
            }) as Promise<string[]>,
        ),
      );
      const all = fired.flat();
      const dup = all.length - new Set(all).size;
      const [db] = await sql`select count(*)::int as n from bench.tm where fired_at is not null`;
      console.log(
        `[rel] B4 ${mode} | 2 Hub đồng thời | bắn=${all.length} trùng=${dup} db_fired=${db?.n}`,
      );
      expect({ dup, total: all.length, db: db?.n }).toEqual({ dup: 0, total: 200, db: 200 });
      // giết kết nối giữa tx (sau 50 hẹn / sau câu theo tập, trước COMMIT) ⇒ không hẹn nào bắn một nửa
      await resetB4(sql);
      const victim = postgres(urls().owner, { max: 1, onnotice: () => {} });
      const [p] = await victim`select pg_backend_pid() as pid`;
      const err = await victim
        .begin(async (tx) => {
          const ts = await claim(tx as unknown as Sql);
          if (mode === "set") await fireSet(tx as unknown as Sql, ts);
          else for (const t of ts.slice(0, 50)) await fireRow(tx as unknown as Sql, t);
          await sql`select pg_terminate_backend(${p?.pid}::int)`;
          await tx`select 1`;
        })
        .then(() => "không lỗi")
        .catch((e: Error) => e.message.slice(0, 60));
      const [after] = await sql`select count(*)::int as n from bench.tm where fired_at is not null`;
      const [stg] = await sql`select count(*)::int as n from bench.sr where status = 'queued'`;
      console.log(
        `[rel] B4 ${mode} | giết kết nối giữa tx | lỗi="${err}" db_fired=${after?.n} stage_queued=${stg?.n}`,
      );
      expect({ fired: after?.n, queued: stg?.n }).toEqual({ fired: 0, queued: 0 });
      await Promise.all(hubs.map((h) => h.end().catch(() => {})));
      // kết nối nạn nhân đã bị PG cắt: không `end()` (postgres.js trên Bun ném khi ghi vào socket đã đóng)
    }
  }, 300_000);
});

// ---------------- B6 · đếm notice chưa đọc trong câu chèn notice (pgss #2: 14 ms, 2.701 buffers/lần) ----------------
const UNREAD = `select n.tenant_id::text, n.user_id::text, count(*)::int as n from bench.pn n
  where n.user_id = any($1::uuid[]) and n.tenant_id = any($2::uuid[]) and n.read_at is null group by 1, 2 order by 2`;
const UNREAD_CNT = `select tenant_id::text, user_id::text, n from bench.uc
  where user_id = any($1::uuid[]) and tenant_id = any($2::uuid[]) and n > 0 order by 2`;

describe.skipIf(!PERF)("B6 · đếm chưa đọc: count(*) index một phần vs bảng đếm", () => {
  for (const n of [100, 20_000])
    it(`B6 · ${n} notice`, async () => {
      await cloneTable(sql, "hub.process_notices", "pn");
      await fill(sql, "pn", n, {
        id: "gen_random_uuid()",
        tenant_id: `'${T}'::uuid`,
        user_id: uidSql(0xe0, "(i % 10) + 1"),
        kind: "'review_assigned'",
        read_at: "case when i % 2 = 0 then null else now() end",
      });
      await sql.unsafe("drop table if exists bench.uc");
      await sql.unsafe(
        "create table bench.uc as select tenant_id, user_id, count(*)::int as n from bench.pn where read_at is null group by 1, 2",
      );
      await sql.unsafe("alter table bench.uc add primary key (user_id, tenant_id)");
      const users = Array.from({ length: 10 }, (_, k) => uid(0xe0, k + 1));
      const rows = await ab(sql, {
        cand: "B6 đếm chưa đọc",
        rows: n,
        variants: [
          {
            name: "hiện tại: count(*) index một phần (đã VACUUM)",
            run: (s) => s.unsafe(UNREAD, [users, [T]]),
          },
          { name: "bảng đếm (tenant,user)→n", run: (s) => s.unsafe(UNREAD_CNT, [users, [T]]) },
        ],
        canon: (r) => [...(r as unknown as Record<string, unknown>[])].map((x) => ({ ...x })),
      });
      // Chi phí ghi của bảng đếm: chèn 100 notice (một câu) vs chèn + upsert bảng đếm (thêm một câu theo tập).
      const ins = (withCounter: boolean) => async (s: Sql) =>
        s.begin(async (tx) => {
          const t = tx as unknown as Sql;
          await t.unsafe(
            `insert into bench.pn (id, tenant_id, user_id, process_run_id, kind, payload, created_at)
            select gen_random_uuid(), $1::uuid, ($2::uuid[])[(g % 10) + 1], gen_random_uuid(), 'review_assigned', '{}'::jsonb, now()
            from generate_series(1, 100) g`,
            [T, users],
          );
          if (withCounter)
            await t.unsafe(
              `insert into bench.uc (tenant_id, user_id, n)
              select $1::uuid, u, 10 from unnest($2::uuid[]) u
              on conflict (user_id, tenant_id) do update set n = bench.uc.n + excluded.n`,
              [T, users],
            );
          return 100;
        }) as Promise<number>;
      await ab(sql, {
        cand: "B6w ghi 100 notice",
        rows: n,
        variants: [
          { name: "hiện tại: chèn", run: ins(false) },
          { name: "chèn + upsert bảng đếm", run: ins(true) },
        ],
        n: 20,
      });
      if (n > 1000) {
        await sql.unsafe("vacuum analyze bench.pn");
        const lit = UNREAD.replace("$1::uuid[]", `'{${users.join(",")}}'::uuid[]`).replace(
          "$2::uuid[]",
          `'{${T}}'::uuid[]`,
        );
        await explain(sql, "B6", "count(*) sau VACUUM", lit);
      }
      expect(rows.every((r) => r.equal)).toBe(true);
    }, 600_000);
});
