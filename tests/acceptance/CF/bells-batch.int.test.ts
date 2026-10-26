// contract-flow fix-review #1 · vòng nhắc THẬT (`remindTasks`, role hub_api, scope system) lô 100 task × 30 thành viên Group
// (3000 notice/lô; trần cũ của `notify.enqueue_pack_runs` là 2000 ⇒ cả lô rollback, nhắc chết mọi tenant). Sau sửa (0060 +
// lọc run gắn gói ở câu notice): lô đi qua, mọi task tiến mốc nhắc, chuông gói CHỈ cho task của run gắn gói (70 × 30).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { connectDb, type Db } from "../../../apps/hub-api/src/lib/db";
import { createHubUow } from "../../../apps/hub-api/src/modules/processes/adapters/hub-uow";
import { remindTasks } from "../../../apps/hub-api/src/modules/processes/application/notify/remind-tasks.usecase";
import {
  HUB_API_URL,
  insertFixture,
  ownerSql,
  prepareDb,
  type Sql,
  T,
  USERS,
} from "../H1/_fixtures";
import {
  DEF_HD,
  fixId,
  insertDef,
  insertOutput,
  insertRun,
  insertTask,
} from "../P-a/_support/process-fixtures";

const N_TASKS = 100;
const N_MEMBERS = 30;
/** 70 × 30 = 2100 chuông > trần cũ 2000 ⇒ đỏ nếu 0060 chưa bỏ RAISE (dù đã lọc run gắn gói). */
const N_PACK = 70;

let sql: Sql;
let db: Db;
const runIds: string[] = [];
const packRuns: string[] = [];

async function seedGroup(s: Sql): Promise<string> {
  const groupId = fixId();
  await s`insert into admin.groups (id, tenant_id, key, name)
    values (${groupId}, ${T.acme}, 'cf-fix-batch', ${s.json({ vi: "Lô", en: "Batch" })})`;
  const users = Array.from({ length: N_MEMBERS }, (_, i) => ({
    id: fixId(),
    tenant_id: T.acme,
    username: `cf_batch_${i}`,
    email: `cf_batch_${i}@example.test`,
    password_hash: "x",
    display_name: `cf_batch_${i}`,
    role: "member",
    locale: "vi",
    active: true,
    locked_by_tenant: false,
    must_change_password: false,
  }));
  await s`insert into admin.users ${s(users)}`;
  const members = users.map((u) => ({ tenant_id: T.acme, group_id: groupId, user_id: u.id }));
  await s`insert into admin.group_members ${s(members)}`;
  return groupId;
}

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  const def = DEF_HD(fixId());
  await insertDef(sql, { id: def.id, tenantId: T.acme });
  const groupId = await seedGroup(sql);
  for (let i = 0; i < N_TASKS; i++) {
    const r = await insertRun(sql, { def, startedBy: USERS.lan, status: "waiting_review" });
    const stageRunId = r.stageRunIds[0] as string;
    const outputId = await insertOutput(sql, {
      tid: T.acme,
      runId: r.runId,
      stageRunId,
      stageIdx: 0,
    });
    await insertTask(sql, {
      tid: T.acme,
      runId: r.runId,
      stageRunId,
      kind: "review",
      outputId,
      groupId,
    });
    runIds.push(r.runId);
    if (i < N_PACK) packRuns.push(r.runId);
  }
  const ids = `{${runIds.join(",")}}`;
  await sql`update hub.review_tasks set remind_at = now() - interval '1 hour'
    where process_run_id = any(${ids}::uuid[])`;
  await sql`update hub.process_runs set pack_key = 'contracts', pack_record_id = gen_random_uuid()
    where id = any(${`{${packRuns.join(",")}}`}::uuid[])`;
  db = connectDb(HUB_API_URL, 2);
}, 120_000);
afterAll(async () => {
  await db?.close();
  await sql?.end();
});

describe("fix-review #1 · lô nhắc lớn + chuông gói", () => {
  it("100 task × 30 thành viên: lô không rollback, mọi task tiến mốc, chuông chỉ cho run gắn gói", async () => {
    const uow = createHubUow(db, { clock: { now: () => new Date() }, publish: async () => {} });
    const n = await remindTasks({ sysUow: uow, now: () => new Date(), elapsedMs: () => 0 });
    expect(n).toBe(N_TASKS);
    const ids = `{${runIds.join(",")}}`;
    const [t] = await sql<{ left: number }[]>`select count(*)::int as left from hub.review_tasks
      where process_run_id = any(${ids}::uuid[]) and reminded_at is null`;
    expect(t?.left).toBe(0);
    const [nt] = await sql<{ n: number }[]>`select count(*)::int as n from hub.process_notices
      where process_run_id = any(${ids}::uuid[]) and kind = 'reminder'`;
    expect(nt?.n).toBe(N_TASKS * N_MEMBERS);
    const [b] = await sql<{ n: number; bad: number }[]>`select count(*)::int as n,
        count(*) filter (where not (link like '/contracts/%' and kind = 'approval.reminder'))::int as bad
      from hub.notifications where tenant_id = ${T.acme} and source = 'contracts'`;
    expect({ n: b?.n, bad: b?.bad }).toEqual({ n: N_PACK * N_MEMBERS, bad: 0 });
  }, 60_000);
});
