// HUB-FR-143 · HUB-FR-144 · review T6c (Thấp): `timers.cancelForRun(runId, stageRunIds, now)` truyền mảng stage qua MỘT
// tham số JSON (không ghép literal mảng): chỉ huỷ hẹn mở của đúng stage chỉ định; mảng rỗng ⇒ 0; "all" ⇒ mọi stage còn lại.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  HUB_API_URL,
  insertFixture,
  ownerSql,
  prepareDb,
  type Sql,
  T,
  USERS,
} from "../../../../../../../tests/acceptance/H1/_fixtures";
import {
  DEF_HD,
  fixId,
  insertDef,
  insertRun,
  type RunFix,
} from "../../../../../../../tests/acceptance/P-a/_support/process-fixtures";
import { connectDb, type Db } from "../../../../lib/db";
import { createHubUow } from "../hub-uow";

let sql: Sql;
let db: Db;
let run: RunFix;
const timers: string[] = [];
beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  const def = DEF_HD(fixId());
  await insertDef(sql, { id: def.id, tenantId: T.acme });
  run = await insertRun(sql, { def, startedBy: USERS.lan });
  const due = new Date(Date.now() + 86_400_000);
  for (const stageRunId of run.stageRunIds) {
    const id = fixId();
    timers.push(id);
    await sql`insert into hub.process_timers (id, tenant_id, process_run_id, stage_run_id, kind, due_at, idempotency_key)
      values (${id}, ${T.acme}, ${run.runId}, ${stageRunId}, 'retry', ${due}, ${`t6c:${id}`})`;
  }
  db = connectDb(HUB_API_URL, 2);
}, 60_000);
afterAll(async () => {
  await db?.close();
  await sql?.end();
});

const cancelled = async () =>
  (
    await sql<{ id: string; cancelled_at: Date | null }[]>`
      select id, cancelled_at from hub.process_timers where id = any(${`{${timers.join(",")}}`}::uuid[])`
  )
    .filter((r) => r.cancelled_at !== null)
    .map((r) => r.id)
    .sort();

describe("T6c · cancelForRun mảng stage là tham số JSON", () => {
  it("HUB-FR-144 · [] ⇒ 0; [stage 0] ⇒ chỉ hẹn stage 0; 'all' ⇒ phần còn lại", async () => {
    const uow = createHubUow(db, { clock: { now: () => new Date() }, publish: async () => {} });
    const now = new Date();
    const cancel = (ids: readonly string[] | "all") =>
      uow.system(T.acme, (r) => r.timers.cancelForRun(run.runId, ids, now));
    const none = await cancel([]);
    const one = await cancel([run.stageRunIds[0] as string]);
    const afterOne = await cancelled();
    const rest = await cancel("all");
    expect({ none, one, afterOne, rest, all: await cancelled() }).toEqual({
      none: 0,
      one: 1,
      afterOne: timers.slice(0, 1),
      rest: timers.length - 1,
      all: [...timers].sort(),
    });
  });
});
