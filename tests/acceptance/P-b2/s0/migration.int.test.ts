// HUB-FR-104 · HUB-FR-113 · HUB-BR-25 · AC-PB2-01/11 · test-plan-cases §3.2 `s0/migration` (M-01…M-08): migration
// `0024_pb2_steps.sql` (plan §5) — idempotent, cột mới + CHECK, bảng `process_back_events` (RLS tenant, append-only, FK,
// index). DB tag `pb2_s0`. Probe RLS: role `hub_api` + `SET LOCAL ROLE hub_rw` + GUC, luôn ROLLBACK (mẫu P-a `rls.int`).
// 0024 vắng ⇒ mọi ca đỏ ở `needPb2` / expect file (không PostgresError ở beforeAll).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { HUB_API_URL } from "../../H1/_fixtures";
import { ROOT } from "../../P-a/_support/modules";
import {
  DEF_HD,
  insertDef,
  insertRun,
  insertTask,
  PA,
  PA_FIX,
  type RunFix,
  setupPa,
  T,
} from "../../P-a/_support/pa";
import { asUser, pgCode } from "../../X2a/_x2a";
import { hasPb2Schema, type Json, needPb2, type Sql } from "../_support/pb2";

let sql: Sql;
let db: Sql;
let ready = false;
let run: RunFix;
let runBeta: RunFix;
const DIR = join(ROOT, "packages/db/migrations-hub");
const file0024 = (): string | undefined => readdirSync(DIR).find((f) => /^0024_.*\.sql$/.test(f));

beforeAll(async () => {
  ({ sql } = await setupPa());
  db = postgres(HUB_API_URL, { max: 4, onnotice: () => {} });
  ready = await hasPb2Schema(sql);
  await insertDef(sql, { id: PA_FIX.defHoaDon, tenantId: T.acme });
  await insertDef(sql, { id: PA_FIX.defBeta, tenantId: T.beta });
  run = await insertRun(sql, { def: DEF_HD(PA_FIX.defHoaDon), startedBy: PA.A, stageIdx: 1 });
  runBeta = await insertRun(sql, { def: DEF_HD(PA_FIX.defBeta), startedBy: PA.D });
}, 60_000);
afterAll(async () => {
  await db?.end();
  await sql?.end();
});

/** Hàng event hợp lệ (ghi đè từng trường). */
const ev = (r: RunFix, tid: string, o: Json = {}): Json => ({
  tenant_id: tid,
  process_run_id: r.runId,
  task_id: null,
  from_stage_idx: 1,
  from_step: 1,
  to_step: 0,
  round_after: 2,
  feedback: "Sai số tổng",
  decided_by: PA.B.id,
  ...o,
});
const insEv = (s: Sql | postgres.TransactionSql, row: Json) =>
  s`insert into hub.process_back_events ${s(row)}`;
const colInfo = async (table: string, col: string) =>
  (
    await sql<Json[]>`select data_type, is_nullable, column_default from information_schema.columns
      where table_schema = 'hub' and table_name = ${table} and column_name = ${col}`
  )[0];

describe("M · migration 0024 [HUB-FR-104]", () => {
  it("HUB-FR-104 · M-01 · _journal có 0023 rồi 0024; chạy SQL 0024 lần 2 không lỗi", async () => {
    const j = JSON.parse(readFileSync(join(DIR, "meta/_journal.json"), "utf8")) as {
      entries: { tag: string }[];
    };
    const tags = j.entries.map((e) => e.tag);
    const i23 = tags.findIndex((t) => t.startsWith("0023_"));
    const i24 = tags.findIndex((t) => t.startsWith("0024_"));
    expect({ has0023: i23 >= 0, has0024: i24 >= 0, order: i23 < i24 }).toEqual({
      has0023: true,
      has0024: true,
      order: true,
    });
    const f = file0024();
    expect({ file0024: f !== undefined }).toEqual({ file0024: true });
    if (!f) return;
    expect(await pgCode(sql.unsafe(readFileSync(join(DIR, f), "utf8")))).toBe("ok");
  });
  it("HUB-FR-104 · M-02 · cột mới: current_step/back_rounds/back_limit, stage_runs.round/back_to_step, process_outputs.round", async () => {
    needPb2(ready);
    const want: [string, string, string, string | null][] = [
      ["process_runs", "current_step", "NO", "0"],
      ["process_runs", "back_rounds", "NO", "0"],
      ["process_runs", "back_limit", "NO", "3"],
      ["stage_runs", "round", "NO", "1"],
      ["stage_runs", "back_to_step", "YES", null],
      ["process_outputs", "round", "NO", "1"],
    ];
    for (const [t, c, nullable, def] of want) {
      const i = await colInfo(t, c);
      expect({
        col: `${t}.${c}`,
        type: i?.data_type,
        nullable: i?.is_nullable,
        def: i?.column_default ?? null,
      }).toEqual({ col: `${t}.${c}`, type: "smallint", nullable, def });
    }
  });
  it("AC-PB2-01 · M-03 · backfill chỉ khi vừa thêm cột: current_step đặt tay = 0 (stage idx 1), chạy lại 0024 ⇒ vẫn 0", async () => {
    needPb2(ready);
    await sql`update hub.process_runs set current_step = 0 where id = ${run.runId}`;
    const f = file0024();
    if (f) await sql.unsafe(readFileSync(join(DIR, f), "utf8"));
    const [r] = await sql<
      Json[]
    >`select current_step, current_stage_idx from hub.process_runs where id = ${run.runId}`;
    expect(r).toEqual({ current_step: 0, current_stage_idx: 1 });
  });
  it("HUB-FR-104 · M-04 · CHECK: current_step 10, back_rounds>back_limit, back_limit 101, round 0, back_to_step 10, reason lạ, event sai ⇒ 23514", async () => {
    needPb2(ready);
    const id = run.runId;
    const s1 = run.stageRunIds[1] as string;
    const bad = {
      step: await pgCode(sql`update hub.process_runs set current_step = 10 where id = ${id}`),
      rounds: await pgCode(
        sql`update hub.process_runs set back_rounds = 4, back_limit = 3 where id = ${id}`,
      ),
      limit: await pgCode(sql`update hub.process_runs set back_limit = 101 where id = ${id}`),
      round: await pgCode(sql`update hub.stage_runs set round = 0 where id = ${s1}`),
      backTo: await pgCode(sql`update hub.stage_runs set back_to_step = 10 where id = ${s1}`),
      evStep: await pgCode(insEv(sql, ev(run, T.acme, { to_step: 1, from_step: 1 }))),
      evRound: await pgCode(insEv(sql, ev(run, T.acme, { round_after: 1 }))),
      evFb: await pgCode(insEv(sql, ev(run, T.acme, { feedback: "" }))),
    };
    expect(bad).toEqual({
      step: "23514",
      rounds: "23514",
      limit: "23514",
      round: "23514",
      backTo: "23514",
      evStep: "23514",
      evRound: "23514",
      evFb: "23514",
    });
    const okTask = await pgCode(
      insertTask(sql, {
        tid: T.acme,
        runId: id,
        stageRunId: s1,
        kind: "decision",
        reason: "back_limit",
      }),
    );
    const badTask = await pgCode(
      insertTask(sql, { tid: T.acme, runId: id, stageRunId: s1, kind: "decision", reason: "xyz" }),
    );
    expect({ okTask, badTask }).toEqual({ okTask: "ok", badTask: "23514" });
  });
});

describe("M · process_back_events RLS + quyền + FK [AC-PB2-11][HUB-BR-25]", () => {
  it("AC-PB2-11 · M-05 · hub_rw scope acme INSERT ok; scope beta SELECT 0 hàng; INSERT tenant khác scope ⇒ lỗi RLS", async () => {
    needPb2(ready);
    await insEv(sql, ev(run, T.acme, { feedback: "Sự kiện M-05" }));
    const ins = await pgCode(asUser(db, PA.A, (tx) => insEv(tx, ev(run, T.acme))));
    const seenBeta = await asUser(
      db,
      PA.D,
      (tx) => tx<Json[]>`select id from hub.process_back_events`,
    );
    const seenAcme = await asUser(
      db,
      PA.A,
      (tx) => tx<Json[]>`select id from hub.process_back_events`,
    );
    const cross = await pgCode(asUser(db, PA.A, (tx) => insEv(tx, ev(runBeta, T.beta))));
    expect({ ins, beta: seenBeta.length, acmeSees: seenAcme.length > 0, cross }).toEqual({
      ins: "ok",
      beta: 0,
      acmeSees: true,
      cross: "42501",
    });
  });
  it("HUB-BR-25 · M-06 · append-only: hub_rw UPDATE / DELETE process_back_events ⇒ 42501", async () => {
    needPb2(ready);
    await insEv(sql, ev(run, T.acme, { feedback: "Sự kiện M-06" }));
    const upd = await pgCode(
      asUser(db, PA.A, (tx) => tx`update hub.process_back_events set feedback = 'x'`),
    );
    const del = await pgCode(asUser(db, PA.A, (tx) => tx`delete from hub.process_back_events`));
    expect({ upd, del }).toEqual({ upd: "42501", del: "42501" });
  });
  it("HUB-FR-113 · M-07 · FK: xoá review_tasks ⇒ task_id NULL; xoá process_runs ⇒ event CASCADE", async () => {
    needPb2(ready);
    const r = await insertRun(sql, { def: DEF_HD(PA_FIX.defHoaDon), startedBy: PA.A, stageIdx: 1 });
    const task = await insertTask(sql, {
      tid: T.acme,
      runId: r.runId,
      stageRunId: r.stageRunIds[1] as string,
      kind: "decision",
      reason: "back_limit",
    });
    const [e] = await sql<
      Json[]
    >`insert into hub.process_back_events ${sql(ev(r, T.acme, { task_id: task }))} returning id`;
    await sql`delete from hub.review_tasks where id = ${task}`;
    const [after] = await sql<
      Json[]
    >`select task_id from hub.process_back_events where id = ${e?.id}`;
    expect(after?.task_id).toBeNull();
    await sql`delete from hub.process_runs where id = ${r.runId}`;
    const left = await sql<Json[]>`select id from hub.process_back_events where id = ${e?.id}`;
    expect(left).toHaveLength(0);
  });
  it("HUB-FR-113 · M-08 · index process_back_events_run_idx (process_run_id, created_at) + policy process_back_events_hub_rw", async () => {
    needPb2(ready);
    const [ix] = await sql<Json[]>`select indexdef from pg_indexes
      where schemaname = 'hub' and indexname = 'process_back_events_run_idx'`;
    expect(String(ix?.indexdef ?? "")).toContain("(process_run_id, created_at)");
    const pol = await sql<Json[]>`select policyname from pg_policies
      where schemaname = 'hub' and tablename = 'process_back_events'`;
    expect(pol.map((p) => p.policyname)).toContain("process_back_events_hub_rw");
  });
});
