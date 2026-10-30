// CR-104 · ops-checks · int (DB test, role hub_api): Provider AI logged_out ⇒ crit qua MỘT lượt kiểm thật (runChecksOnce → ops_checks,
// ops_events, chuông); runs_failed (% failed + ALL_PROVIDERS_EXHAUSTED); stuck chạy được dưới RLS scope system trên jobs/process_runs.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  HUB_API_URL,
  insertFixture,
  ownerSql,
  prepareDb,
  R,
  type Sql,
  USERS,
} from "../../../../../tests/acceptance/H1/_fixtures";
import { connectDb, type Db } from "../../lib/db";
import { providerCheck } from "./adapters/checks/provider.check";
import { runsAggQuery, runsFailedCheck } from "./adapters/checks/runs-failed.check";
import { stuckCheck, stuckQuery } from "./adapters/checks/stuck.check";
import { runChecksOnce } from "./application/ops.round";
import { opsRoundDeps } from "./ops.mount";

let sql: Sql;
let db: Db;
const NOW = new Date();
const deps = () =>
  opsRoundDeps({
    db,
    ops: { checks: [providerCheck, runsFailedCheck, stuckCheck], timeoutMs: 5_000 },
    log: console as never,
  });
const row = async (key: string) =>
  (
    await sql<{ status: string; hint: string | null; message: string }[]>`
    select status, hint, message from hub.ops_checks where check_key = ${key}`
  )[0];

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await sql`insert into hub.providers (key, kind, vendor) values ('ops-claude', 'subscription', 'anthropic')`;
  db = connectDb(HUB_API_URL, 4);
}, 60_000);
afterAll(async () => {
  await db?.close();
  await sql?.end();
});
beforeEach(async () => {
  await sql`delete from hub.ops_checks`;
  await sql`delete from hub.ops_events`;
  await sql`update hub.ops_settings set settings = '{}', last_round_at = null, last_manual_at = null where id = 1`;
  await sql`delete from hub.runs where id not in (${R.runDone}, ${R.runLive})`;
});

const addRuns = (n: number, status: "finished" | "failed", code: string | null = null) =>
  sql`insert into hub.runs (tenant_id, user_id, conversation_id, flow_id, status, config_version, user_message_id,
      answer_message_id, error_code, error_message, error_hint, started_at, finished_at)
    select ${USERS.lan.tid}, ${USERS.lan.id}, ${R.conv}, ${R.flow}, ${status}, 1, ${R.msgU1}, ${R.msgA1},
      ${code}, ${code ? "lỗi" : null}, ${code ? "gợi ý" : null}, now() - interval '5 minutes', now() - interval '1 minute'
    from generate_series(1, ${n})`;

describe("ops-checks · int", () => {
  it("Provider AI: logged_out ⇒ crit trong lượt kiểm kế tiếp, kèm gợi ý đăng nhập lại", async () => {
    await sql`insert into hub.provider_state (provider_key, status, last_error)
      values ('ops-claude', 'logged_out', 'not logged in /home/app/.claude/x') on conflict (provider_key)
      do update set status = 'logged_out', last_error = excluded.last_error`;
    const r = await runChecksOnce(deps(), NOW);
    expect(r.ran).toBe(true);
    const p = await row("provider");
    expect(p?.status).toBe("crit");
    expect(p?.hint).toContain("gen-env.sh");
    expect(p?.message).not.toContain("/home/app");
    expect(
      (await sql`select 1 from hub.ops_events where check_key = 'provider' and to_status = 'crit'`)
        .length,
    ).toBe(1);
  });

  it("runs_failed: 12 run, 5 failed ⇒ warn; thêm ALL_PROVIDERS_EXHAUSTED ⇒ crit; stuck không lỗi RLS", async () => {
    await addRuns(5, "finished");
    await addRuns(5, "failed", "TIMEOUT");
    await runChecksOnce(deps(), NOW);
    expect((await row("runs_failed"))?.status).toBe("warn"); // 12 run (gồm 2 của fixture), 5 failed ≈ 42%
    expect((await row("stuck"))?.status).toBe("ok");
    await addRuns(1, "failed", "ALL_PROVIDERS_EXHAUSTED");
    await sql`update hub.ops_settings set last_round_at = null where id = 1`;
    await runChecksOnce(deps(), new Date(NOW.getTime() + 60_000));
    expect((await row("runs_failed"))?.status).toBe("crit");
  });

  it("Luật 4c: câu runs_failed/stuck dùng chỉ mục (EXPLAIN) trên bảng 20.000 dòng; process_runs có chỉ mục từng phần", async () => {
    await sql`insert into hub.runs (tenant_id, user_id, conversation_id, flow_id, status, config_version, user_message_id,
        answer_message_id, started_at, finished_at)
      select ${USERS.lan.tid}, ${USERS.lan.id}, ${R.conv}, ${R.flow}, 'finished', 1, ${R.msgU1}, ${R.msgA1},
        now() - (g || ' minutes')::interval - interval '2 hours', now() - (g || ' minutes')::interval - interval '2 hours'
      from generate_series(1, 20000) g`;
    await sql`analyze hub.runs`;
    const d = new PgDialect();
    const plan = async (q: Parameters<PgDialect["sqlToQuery"]>[0]) => {
      const { sql: text, params } = d.sqlToQuery(q);
      const rows = await sql.unsafe(`explain ${text}`, params as never[]);
      return rows.map((r) => String(r["QUERY PLAN"])).join("\n");
    };
    const h = new Date(NOW.getTime() - 3_600_000).toISOString();
    const m = new Date(NOW.getTime() - 1_800_000).toISOString();
    const runsPlan = await plan(runsAggQuery(h, m));
    expect(runsPlan).toContain("runs_started_at_idx");
    expect(runsPlan).toContain("runs_exhausted_finished_idx");
    expect(runsPlan).not.toMatch(/Seq Scan on runs/);
    const stuckPlan = await plan(stuckQuery(h, NOW.toISOString()));
    expect(stuckPlan).toContain("jobs_orphaned_finished_idx");
    expect(stuckPlan).toContain("process_runs_running_expires_idx");
  });
});
