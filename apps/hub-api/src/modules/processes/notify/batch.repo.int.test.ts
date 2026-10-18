// HUB-FR-143 · HUB-FR-112 · K3 lô · review T6c (Trung #2): `writeNotices` (role hub_api, scope system qua `systemBatch`)
// KHÔNG chèn notice cho user ngoài tenant của hàng (`exists admin.users(id, tenant_id)`), unread/sự kiện chỉ cho hàng chèn
// thật. Hai tenant cùng lô: acme/lan hợp lệ; beta/lan, acme/an, acme/<không có> bị bỏ. Vẫn MỘT câu SQL cho cả lô.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  HUB_API_URL,
  insertFixture,
  ownerSql,
  prepareDb,
  type Sql,
  T,
  UNKNOWN,
  USERS,
} from "../../../../../../tests/acceptance/H1/_fixtures";
import {
  DEF_HD,
  fixId,
  insertDef,
  insertRun,
} from "../../../../../../tests/acceptance/P-a/_support/process-fixtures";
import { connectDb, type Db } from "../../../lib/db";
import { createHubUow } from "../adapters/hub-uow";
import type { NoticeRow, OutboxEvent } from "../application/ports";

let sql: Sql;
let db: Db;
let acmeRun: string;
let betaRun: string;
beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  const acmeDef = DEF_HD(fixId());
  const betaDef = DEF_HD(fixId());
  await insertDef(sql, { id: acmeDef.id, tenantId: T.acme });
  await insertDef(sql, { id: betaDef.id, tenantId: T.beta });
  acmeRun = (await insertRun(sql, { def: acmeDef, startedBy: USERS.lan })).runId;
  betaRun = (await insertRun(sql, { def: betaDef, startedBy: USERS.an })).runId;
  db = connectDb(HUB_API_URL, 2);
}, 60_000);
afterAll(async () => {
  await db?.close();
  await sql?.end();
});

function makeUow() {
  const published: OutboxEvent[] = [];
  const uow = createHubUow(db, {
    clock: { now: () => new Date() },
    publish: async (events) => void published.push(...events),
  });
  return { uow, published };
}
const row = (tenantId: string, userId: string, processRunId: string): NoticeRow => ({
  tenantId,
  userId,
  processRunId,
  taskId: null,
  payload: { process_name: "Hoá đơn thử", stage_name: null },
});
const noticesOf = (runIds: string[]) =>
  sql<{ tenant_id: string; user_id: string; process_run_id: string }[]>`
    select tenant_id, user_id, process_run_id from hub.process_notices
    where process_run_id = any(${`{${runIds.join(",")}}`}::uuid[]) order by created_at, id`;

describe("T6c · notice chỉ cho user cùng tenant của hàng", () => {
  it("HUB-FR-143 · K3 · insertMany 2 tenant: chỉ acme/lan được chèn; user chéo tenant/không tồn tại ⇒ 0 hàng, 0 unread", async () => {
    const { uow } = makeUow();
    const L = USERS.lan;
    const out = await uow.systemBatch((r) =>
      r.notices.insertMany("reminder", [
        row(T.acme, L.id, acmeRun),
        row(T.beta, L.id, betaRun), // lan ∉ beta
        row(T.acme, USERS.an.id, acmeRun), // an ∉ acme
        row(T.acme, UNKNOWN, acmeRun), // user không tồn tại
      ]),
    );
    expect({
      inserted: out.inserted.map((n) => [n.tenantId, n.userId, n.row.processRunId]),
      unread: [...out.unread.entries()],
    }).toEqual({
      inserted: [[T.acme, L.id, acmeRun]],
      unread: [[`${T.acme}:${L.id}`, 1]],
    });
    const stored = await noticesOf([acmeRun, betaRun]);
    expect(stored.map((n) => [n.tenant_id, n.user_id, n.process_run_id])).toEqual([
      [T.acme, L.id, acmeRun],
    ]);
  });

  it("HUB-FR-143 · K3 · runsFinished lô 2 tenant: startedBy chéo tenant ⇒ không notice, không sự kiện process.notice", async () => {
    const { uow, published } = makeUow();
    const before = (await noticesOf([acmeRun, betaRun])).length;
    await uow.systemBatch((r) =>
      r.notifier.runsFinished([
        { id: acmeRun, tenantId: T.acme, startedBy: USERS.lan.id, processName: "A" },
        { id: betaRun, tenantId: T.beta, startedBy: USERS.lan.id, processName: "B" }, // lan ∉ beta
      ]),
    );
    const events = published.flatMap((e) => (e.kind === "user_events" ? e.events : [])) as {
      userIds: string[];
      event: string;
      data: { notice: { process_run_id: string }; unread: number };
    }[];
    expect(
      events.map((e) => ({ to: e.userIds, event: e.event, run: e.data.notice.process_run_id })),
    ).toEqual([{ to: [USERS.lan.id], event: "process.notice", run: acmeRun }]);
    const after = await noticesOf([acmeRun, betaRun]);
    expect(after.length - before).toBe(1);
    expect(after.filter((n) => n.process_run_id === betaRun)).toEqual([]);
  });
});
