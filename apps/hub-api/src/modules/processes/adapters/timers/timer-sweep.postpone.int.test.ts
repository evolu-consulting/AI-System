// HUB-FR-143 · HUB-FR-144 · review T12 vòng 2 R2-2/R2-3 · `postponeFailed` lùi hẹn lỗi theo HẠN GỐC (2 × độ trễ, kẹp
// [1 phút, 1 giờ]) và `wait_until` đã bị lùi vẫn in NGÀY gốc ở output "Đã chờ tới …". Đồng hồ giả (tham số `now`), không ngủ.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  HUB_API_URL,
  insertFixture,
  ownerSql,
  prepareDb,
  type Sql,
  USERS,
} from "../../../../../../../tests/acceptance/H1/_fixtures";
import {
  defInput,
  fixId,
  insertDef,
  insertRun,
  type RunFix,
  stageDef,
} from "../../../../../../../tests/acceptance/P-a/_support/process-fixtures";
import { connectDb, type Db } from "../../../../lib/db";
import { fireTimer } from "../../application/timers/fire-timer.usecase";
import { createHubUow } from "../hub-uow";
import { type DueTimer, postponeFailed } from "./timer-sweep";

const L = USERS.lan;
const TZ = "Asia/Ho_Chi_Minh";
/** 2026-12-01 09:00 ở Asia/Ho_Chi_Minh (UTC+7). */
const ORIGINAL = new Date("2026-12-01T02:00:00Z");
const MIN = 60_000;
let sql: Sql;
let db: Db;
let run: RunFix;
let timerId: string;

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  const wait = stageDef({
    key: "cho",
    name: "Chờ hạn",
    executor: {
      kind: "wait_until",
      from: { kind: "input", key: "ngay" },
      offset_days: 0,
      time: "09:00",
    },
    after: { kind: "auto" },
  });
  const input = defInput({
    key: `pd-pp-${fixId().slice(0, 8)}`,
    stages: [wait, stageDef({ key: "sau" })],
  });
  const def = {
    id: fixId(),
    key: input.key as string,
    name: input.name as string,
    stages: input.stages as never[],
  };
  await insertDef(sql, { id: def.id, tenantId: L.tid, input });
  run = await insertRun(sql, { def, startedBy: L, stageStatus: "waiting_timer" });
  await sql`update hub.process_runs set inputs = ${sql.json([{ key: "ngay", type: "date", value: "2026-12-01" }])}
    where id = ${run.runId}`;
  timerId = fixId();
  await sql`insert into hub.process_timers (id, tenant_id, process_run_id, stage_run_id, kind, due_at, timezone,
      idempotency_key)
    values (${timerId}, ${L.tid}, ${run.runId}, ${run.stageRunIds[0] as string}, 'wait_until', ${ORIGINAL}, ${TZ},
      ${`pp:${timerId}`})`;
  db = connectDb(HUB_API_URL, 2);
}, 60_000);
afterAll(async () => {
  await db?.close();
  await sql?.end();
});

const due = async (): Promise<Date> =>
  (await sql<{ due_at: Date }[]>`select due_at from hub.process_timers where id = ${timerId}`)[0]
    ?.due_at as Date;
const candidate = (): DueTimer => ({
  id: timerId,
  tenant_id: L.tid,
  process_run_id: run.runId,
  stage_run_id: run.stageRunIds[0] as string,
});
const postpone = (now: Date) =>
  postponeFailed(
    { db, log: { warn: () => {} } } as unknown as Parameters<typeof postponeFailed>[0],
    candidate(),
    now,
  );

describe("R2-2 · R2-3 · postponeFailed giữ hạn gốc", () => {
  it("HUB-FR-144 · R2-2 · lùi = 2 × (now − hạn GỐC) kẹp [1 phút, 1 giờ]; lần lỗi thứ hai dùng hạn gốc, không dùng due_at đã lùi", async () => {
    const now1 = new Date(ORIGINAL.getTime() + 10 * MIN);
    await postpone(now1);
    expect((await due()).toISOString()).toBe(new Date(now1.getTime() + 20 * MIN).toISOString());
    // due_at đã lùi ⇒ độ trễ theo due_at chỉ 1 phút (⇒ 2 phút); theo hạn gốc là 31 phút (⇒ kẹp 1 giờ).
    const now2 = new Date(now1.getTime() + 21 * MIN);
    await postpone(now2);
    expect((await due()).toISOString()).toBe(new Date(now2.getTime() + 60 * MIN).toISOString());
  });

  it("HUB-FR-144 · R2-3 · wait_until đã lùi bắn ⇒ output in ngày/giờ gốc, không in giờ đã lùi", async () => {
    const postponed = await due();
    expect(postponed.getTime()).toBeGreaterThan(ORIGINAL.getTime());
    const uow = createHubUow(db, { clock: { now: () => postponed }, publish: async () => {} });
    const c = { id: timerId, runId: run.runId, stageRunId: run.stageRunIds[0] as string };
    const out = await uow.system(L.tid, (r) => fireTimer(r, c, postponed));
    expect(out).toBe("fired");
    const rows = await sql<{ content: string }[]>`select content from hub.process_outputs
      where stage_run_id = ${c.stageRunId}`;
    expect(rows.map((r) => r.content)).toEqual([
      `# Chờ hạn\n\nĐã chờ tới 2026-12-01 09:00 (${TZ}).\n\n## Bàn giao\nĐã chờ tới 2026-12-01 09:00 (${TZ}).\n`,
    ]);
  });
});
