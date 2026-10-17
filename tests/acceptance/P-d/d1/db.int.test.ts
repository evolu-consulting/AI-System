// AC-H46 · HUB-FR-143…145 · HUB-FR-115 · ADM-FR-72 · K7 · test-plan-int §6 (PD-I68…PD-I72; plan-db §1–§2): migration 0036 +
// 0011 chạy lại an toàn (snapshot giống hệt — mẫu `H1/db.int.test.ts:80-97`), hàng cũ nhận mặc định, CHECK nới/siết,
// metadata RLS/policy/GRANT/index. Không cần hub-api. Fixture 0036 chỉ chèn sau `needPdSchema`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { runMigrations } from "@ai/db";
import { runHubMigrations } from "@ai/db/migrate-hub";
import { OWNER_URL } from "../../H1/_fixtures";
import {
  DEF_HD,
  insertDef,
  insertOutput,
  insertRun,
  insertTask,
  type Json,
  PA,
  PA_FIX,
  type RunFix,
  type Sql,
  setupPa,
  T,
} from "../../P-a/_support/pa";
import { pgCode } from "../../X2a/_x2a";
import { hasPdSchema, needPdSchema } from "../_support/pd";
import { insertTimer } from "../_support/two-tenant";

let sql: Sql;
let pd = false;
beforeAll(async () => {
  const s = await setupPa();
  sql = s.sql;
  pd = await hasPdSchema(sql);
}, 60_000);
afterAll(async () => {
  await sql?.end();
});

const MIG_0036 = new URL(
  "../../../../packages/db/migrations-hub/0036_pd1_durable.sql",
  import.meta.url,
);

/** Mô tả schema `hub` + `admin.tenants` (cột, ràng buộc, index, policy, RLS). */
async function schemaOf(db: Sql): Promise<Json> {
  const cols =
    await db`select table_schema, table_name, column_name, data_type, is_nullable, column_default
    from information_schema.columns where table_schema = 'hub' or (table_schema = 'admin' and table_name = 'tenants')
    order by 1, 2, 3`;
  const cons =
    await db`select c.conrelid::regclass::text as tbl, c.conname, pg_get_constraintdef(c.oid) as def
    from pg_constraint c join pg_namespace n on n.oid = c.connamespace
    where n.nspname = 'hub' or c.conrelid = 'admin.tenants'::regclass order by 1, 2`;
  const idx =
    await db`select tablename, indexname, indexdef from pg_indexes where schemaname = 'hub' order by 1, 2`;
  const pol = await db`select tablename, policyname, roles::text as roles, cmd, qual, with_check
    from pg_policies where schemaname = 'hub' order by 1, 2`;
  const rls = await db`select relname, relrowsecurity, relforcerowsecurity from pg_class c
    join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'hub' and c.relkind = 'r' order by 1`;
  return { cols: [...cols], cons: [...cons], idx: [...idx], pol: [...pol], rls: [...rls] };
}

let seq = 0;
/** Run acme 2 stage (def `hoa-don-t`) — đủ hàng cha cho mọi ca CHECK. */
async function acmeRun(status = "waiting_review", stageStatus?: string): Promise<RunFix> {
  seq += 1;
  if (seq === 1) await insertDef(sql, { id: PA_FIX.defHoaDon, tenantId: T.acme });
  return insertRun(sql, { def: DEF_HD(PA_FIX.defHoaDon), startedBy: PA.A, status, stageStatus });
}

describe("AC-H46 · migration 0036/0011 + CHECK + metadata", () => {
  it("AC-H46 · PD-I68 · migrate lần 2 (runner + chạy lại nguyên văn 0036) không lỗi; snapshot cột/ràng buộc/index/policy/RLS giống hệt", async () => {
    needPdSchema(pd);
    expect({ file0036: existsSync(MIG_0036) }).toEqual({ file0036: true });
    const before = await schemaOf(sql);
    expect(await runHubMigrations({ url: OWNER_URL, appEnv: "test" })).toEqual({
      hub: 0,
      hubDev: 0,
    });
    expect(await runMigrations({ url: OWNER_URL, appEnv: "test" })).toEqual({ main: 0, dev: 0 });
    const text = readFileSync(MIG_0036, "utf8").replaceAll("--> statement-breakpoint", "");
    expect({ rerun0036: await pgCode(sql.unsafe(text)) }).toEqual({ rerun0036: "ok" });
    expect(await schemaOf(sql)).toEqual(before);
  }, 60_000);

  it("AC-H46 · PD-I69 · hàng ghi kiểu cũ (không cột mới) ⇒ ttl_days 7, retry_count 0, remind_count 0, tenants.timezone Asia/Ho_Chi_Minh; expires_at nullable", async () => {
    needPdSchema(pd);
    const r = await acmeRun();
    const out = await insertOutput(sql, {
      tid: T.acme,
      runId: r.runId,
      stageRunId: r.stageRunIds[0] as string,
      stageIdx: 0,
    });
    const task = await insertTask(sql, {
      tid: T.acme,
      runId: r.runId,
      stageRunId: r.stageRunIds[0] as string,
      kind: "review",
      outputId: out,
    });
    const [row] = await sql<Json[]>`select
      (select ttl_days from hub.process_defs where id = ${PA_FIX.defHoaDon}) as ttl_days,
      (select retry_count from hub.stage_runs where id = ${r.stageRunIds[0] as string}) as retry_count,
      (select remind_count from hub.review_tasks where id = ${task}) as remind_count,
      (select is_nullable from information_schema.columns where table_schema = 'hub'
         and table_name = 'process_runs' and column_name = 'expires_at') as expires_nullable`;
    expect(row).toEqual({ ttl_days: 7, retry_count: 0, remind_count: 0, expires_nullable: "YES" });
    const tz = await sql<{ id: string; timezone: string }[]>`select id, timezone from admin.tenants
      where id in (${T.acme}, ${T.beta}) order by id`;
    expect(tz.map((t) => t.timezone)).toEqual(["Asia/Ho_Chi_Minh", "Asia/Ho_Chi_Minh"]);
    expect({
      nullOk: await pgCode(
        sql`update hub.process_runs set expires_at = null where id = ${r.runId}`,
      ),
    }).toEqual({
      nullOk: "ok",
    });
  });

  it("AC-H46 · PD-I70 · CHECK nới nhận giá trị mới; từ chối giá trị lạ / ngoài ngưỡng (23514)", async () => {
    needPdSchema(pd);
    const w = await acmeRun("waiting_timer", "waiting_timer");
    expect((await sql`select status from hub.process_runs where id = ${w.runId}`)[0]?.status).toBe(
      "waiting_timer",
    );
    const r = await acmeRun();
    const [s0, s1] = r.stageRunIds as [string, string];
    const dec = (sr: string, reason: string) =>
      pgCode(
        insertTask(sql, { tid: T.acme, runId: r.runId, stageRunId: sr, kind: "decision", reason }),
      );
    expect(await dec(s0, "retry_exhausted")).toBe("ok");
    expect(await dec(s1, "timer_invalid")).toBe("ok");
    const out = await insertOutput(sql, {
      tid: T.acme,
      runId: r.runId,
      stageRunId: s0,
      stageIdx: 0,
    });
    const task = await insertTask(sql, {
      tid: T.acme,
      runId: r.runId,
      stageRunId: s0,
      kind: "review",
      outputId: out,
    });
    const asg = (via: string) =>
      pgCode(sql`insert into hub.review_task_assignees (tenant_id, task_id, group_id, via, depth)
        values (${T.acme}, ${task}, ${PA_FIX.gKeToan}, ${via}, 0)`);
    const notice = (kind: string) =>
      pgCode(sql`insert into hub.process_notices (tenant_id, user_id, kind, process_run_id, task_id, payload)
        values (${T.acme}, ${PA.B.id}, ${kind}, ${r.runId}, ${task}, ${sql.json({ process_name: "Hoá đơn thử" })})`);
    const audit = (action: string) =>
      pgCode(sql`insert into hub.audit_log (tenant_id, action, entity, entity_id, entity_name)
        values (${T.acme}, ${action}, 'review_task', ${task}, 'Hoá đơn thử')`);
    expect({
      escalated: await asg("escalated"),
      notice: await notice("escalated"),
      escalate: await audit("escalate"),
      skipped: await audit("escalate_skipped"),
    }).toEqual({ escalated: "ok", notice: "ok", escalate: "ok", skipped: "ok" });
    const set = (q: Promise<unknown>) => pgCode(q);
    expect({
      runX: await set(sql`update hub.process_runs set status = 'waiting_x' where id = ${r.runId}`),
      stageX: await set(sql`update hub.stage_runs set status = 'waiting_x' where id = ${s1}`),
      viaX: await asg("x"),
      retry4: await set(sql`update hub.stage_runs set retry_count = 4 where id = ${s0}`),
      remind11: await set(sql`update hub.review_tasks set remind_count = 11 where id = ${task}`),
      every3: await set(sql`update hub.review_tasks set remind_every_h = 3 where id = ${task}`),
      ttl0: await set(sql`update hub.process_defs set ttl_days = 0 where id = ${PA_FIX.defHoaDon}`),
    }).toEqual({
      runX: "23514",
      stageX: "23514",
      viaX: "23514",
      retry4: "23514",
      remind11: "23514",
      every3: "23514",
      ttl0: "23514",
    });
    expect({
      stageWT: await set(sql`update hub.stage_runs set status = 'waiting_timer' where id = ${s1}`),
      every4: await set(sql`update hub.review_tasks set remind_every_h = 4 where id = ${task}`),
      ttlNull: await set(
        sql`update hub.process_defs set ttl_days = null where id = ${PA_FIX.defHoaDon}`,
      ),
    }).toEqual({ stageWT: "ok", every4: "ok", ttlNull: "ok" });
  });

  it("AC-H46 · PD-I71 · process_timers CHECK: kind lạ, wait_until thiếu timezone, retry có timezone, fired+cancelled ⇒ 23514; trùng idempotency_key ⇒ 23505", async () => {
    needPdSchema(pd);
    const r = await acmeRun("running", "waiting_timer");
    const sr = r.stageRunIds[0] as string;
    const due = new Date(Date.now() + 86_400_000);
    const t = (o: Json) =>
      pgCode(insertTimer(sql, { tid: T.acme, runId: r.runId, stageRunId: sr, dueAt: due, ...o }));
    expect({
      cron: await t({ kind: "cron", timezone: null, key: "k-cron" }),
      waitNoTz: await t({ kind: "wait_until", timezone: null, key: "k-w0" }),
      retryTz: await t({ kind: "retry", timezone: "Asia/Ho_Chi_Minh", key: "k-r0" }),
      both: await t({ kind: "retry", key: "k-r1", firedAt: new Date(), cancelledAt: new Date() }),
    }).toEqual({ cron: "23514", waitNoTz: "23514", retryTz: "23514", both: "23514" });
    expect(await t({ kind: "retry", key: "k-dup" })).toBe("ok");
    expect(await t({ kind: "wait_until", key: "k-dup" })).toBe("23505");
    expect(await t({ kind: "wait_until", timezone: "Europe/Berlin", key: "k-w1" })).toBe("ok");
  });

  it("AC-H46 · K7 · PD-I72 · metadata: RLS bật không FORCE, policy hub_rw, GRANT không DELETE, index mới, index cũ process_runs_expires_idx bỏ", async () => {
    needPdSchema(pd);
    const [rls] = await sql<Json[]>`select relrowsecurity, relforcerowsecurity from pg_class
      where oid = 'hub.process_timers'::regclass`;
    expect(rls).toEqual({ relrowsecurity: true, relforcerowsecurity: false });
    const pol = await sql<Json[]>`select policyname, roles::text as roles, cmd from pg_policies
      where schemaname = 'hub' and tablename = 'process_timers'`;
    expect([...pol]).toEqual([
      { policyname: "process_timers_hub_rw", roles: "{hub_rw}", cmd: "ALL" },
    ]);
    const can = async (role: string, priv: string) =>
      (
        await sql<
          { ok: boolean }[]
        >`select has_table_privilege(${role}, 'hub.process_timers', ${priv}) as ok`
      )[0]?.ok;
    expect({
      sel: await can("hub_rw", "SELECT"),
      ins: await can("hub_rw", "INSERT"),
      upd: await can("hub_rw", "UPDATE"),
      del: await can("hub_rw", "DELETE"),
      rt: await can("agent_runtime", "SELECT"),
    }).toEqual({ sel: true, ins: true, upd: true, del: false, rt: false });
    const idx = await sql<
      { indexname: string; indexdef: string }[]
    >`select indexname, indexdef from pg_indexes
      where schemaname = 'hub' and tablename in ('process_timers', 'process_runs', 'review_tasks')`;
    const names = new Set(idx.map((i) => i.indexname));
    for (const n of [
      "process_timers_due_idx",
      "process_timers_run_idx",
      "process_timers_stage_idx",
      "process_runs_expiring_idx",
      "review_tasks_remind_due_idx",
      "review_tasks_escalate_idx",
    ])
      expect({ n, has: names.has(n) }).toEqual({ n, has: true });
    expect({ old: names.has("process_runs_expires_idx") }).toEqual({ old: false });
    const due = idx.find((i) => i.indexname === "process_timers_due_idx")?.indexdef ?? "";
    expect({ partial: /WHERE/i.test(due) && /fired_at IS NULL/i.test(due) }).toEqual({
      partial: true,
    });
    const cons = await sql<{ conname: string }[]>`select conname from pg_constraint
      where conname in ('stage_runs_id_tenant_uq', 'process_timers_run_fk', 'process_timers_stage_fk',
        'process_timers_key_uq', 'tenants_timezone_check') order by 1`;
    expect(cons.map((r) => r.conname)).toEqual([
      "process_timers_key_uq",
      "process_timers_run_fk",
      "process_timers_stage_fk",
      "stage_runs_id_tenant_uq",
      "tenants_timezone_check",
    ]);
  });
});
