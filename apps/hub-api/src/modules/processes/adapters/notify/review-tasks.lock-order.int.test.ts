// HUB-FR-145 · HUB-FR-112 · review T12 #1 · lô nhắc/chuyển cấp KHÔNG được chờ khoá run (FK `process_notices` →
// `process_runs` lấy FOR KEY SHARE) khi tx duyệt giữ `lockRun(R)` rồi đóng task ⇒ 40P01. Tất định, không ngủ: tx A giữ
// `lockRun(R)`; tx B (`lock_timeout` thấp — chờ khoá nào cũng ném 55P03) claim nhắc + chuyển cấp rồi chèn notice cho hàng
// đã claim ⇒ T (run R) bị bỏ (vẫn tính vào `claimed` để xả tiếp), T2 (run R2) được nhận; A commit ⇒ lô kế nhận T.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql as dsql } from "drizzle-orm";
import {
  HUB_API_URL,
  insertFixture,
  ownerSql,
  prepareDb,
  type Sql,
  USERS,
} from "../../../../../../../tests/acceptance/H1/_fixtures";
import {
  DEF_HD,
  fixId,
  insertDef,
  insertOutput,
  insertRun,
  insertTask,
} from "../../../../../../../tests/acceptance/P-a/_support/process-fixtures";
import { connectDb, type Db } from "../../../../lib/db";
import type { EscalationBatch, ReminderBatch } from "../../application/ports";
import { lockRun } from "../../core/core.repo";
import { writeNotices } from "../../notify/batch.repo";
import {
  addEscalatedGroups,
  auditEscalations,
  claimDueEscalations,
  claimDueReminders,
  markRemindedMany,
} from "./review-tasks.repo";

const L = USERS.lan;
let sql: Sql;
let db: Db;
let runR: string;
let taskT: string;
let taskT2: string;

async function dueTask(def: ReturnType<typeof DEF_HD>): Promise<{ runId: string; taskId: string }> {
  const run = await insertRun(sql, { def, startedBy: L });
  const stageRunId = run.stageRunIds[0] as string;
  const outputId = await insertOutput(sql, {
    tid: L.tid,
    runId: run.runId,
    stageRunId,
    stageIdx: 0,
  });
  const taskId = await insertTask(sql, {
    tid: L.tid,
    runId: run.runId,
    stageRunId,
    outputId,
    kind: "review",
    userIds: [L.id],
  });
  await sql`update hub.review_tasks set remind_at = now() - interval '1 hour',
      escalate_at = now() - interval '1 hour', escalate_group_id = ${fixId()}
    where id = ${taskId}`;
  return { runId: run.runId, taskId };
}

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  const def = DEF_HD(fixId());
  await insertDef(sql, { id: def.id, tenantId: L.tid });
  const a = await dueTask(def);
  const b = await dueTask(def);
  runR = a.runId;
  taskT = a.taskId;
  taskT2 = b.taskId;
  db = connectDb(HUB_API_URL, 3);
}, 60_000);
afterAll(async () => {
  await db?.close();
  await sql?.end();
});

const mine = (ids: string[]) => ids.filter((id) => id === taskT || id === taskT2).sort();

/** R2-4 · các câu GHI của lô (R2-4: cũng dưới `lock_timeout`): áp mốc nhắc, thêm Group chuyển cấp, audit, notice. */
async function writesB(tx: Tx, now: Date, rem: ReminderBatch, esc: EscalationBatch): Promise<void> {
  const claimed = rem.tasks.filter((t) => t.taskId === taskT || t.taskId === taskT2);
  await markRemindedMany(
    tx,
    now,
    claimed.map((t) => ({
      taskId: t.taskId,
      tenantId: t.tenantId,
      remindAt: t.remindAt,
      remindCount: t.remindCount,
    })),
  );
  const escs = esc.tasks.filter((t) => t.taskId === taskT || t.taskId === taskT2);
  await addEscalatedGroups(
    tx,
    escs.map((t) => ({ tenantId: t.tenantId, taskId: t.taskId, groupId: t.toGroupId })),
  );
  await auditEscalations(
    tx,
    escs.map((t) => ({
      tenantId: t.tenantId,
      taskId: t.taskId,
      action: "escalate_skipped" as const,
      entityName: t.stageName ?? t.processName,
      fromGroupId: t.fromGroupId,
      toGroupId: t.toGroupId,
    })),
  );
  await writeNotices(
    tx,
    "reminder",
    claimed.map((t) => ({
      tenantId: t.tenantId,
      userId: L.id,
      processRunId: t.processRunId,
      taskId: t.taskId,
      payload: { process_name: t.processName, stage_name: t.stageName },
    })),
  );
}

/** Tx B: mọi chờ khoá ⇒ 55P03 sau 200 ms (thay cho "chờ rồi deadlock"); claim nhắc + chuyển cấp + mọi câu ghi của lô. */
function batchB(now: Date) {
  return withHubScope(db, { kind: "system" }, async (tx) => {
    await tx.execute(dsql`set local lock_timeout = '200ms'`);
    const rem = await claimDueReminders(tx, now, 1000);
    const esc = await claimDueEscalations(tx, now, 1000);
    await writesB(tx, now, rem, esc);
    return {
      reminded: mine(rem.tasks.map((t) => t.taskId)),
      escalated: mine(esc.tasks.map((t) => t.taskId)),
      droppedRem: rem.claimed - rem.tasks.length,
      droppedEsc: esc.claimed - esc.tasks.length,
    };
  });
}

describe("T12 #1 · lô nhắc/chuyển cấp không chờ khoá run", () => {
  it("HUB-FR-145 · tx A giữ lockRun(R) ⇒ lô bỏ T (không chờ, không 55P03/40P01), nhận T2; A commit ⇒ lô kế nhận T", async () => {
    const now = new Date();
    const during = await withHubScope(db, { kind: "system" }, async (a) => {
      const head = await lockRun(a, L.tid, runR);
      expect(head?.id).toBe(runR);
      return batchB(now);
    });
    expect(during).toEqual({
      reminded: [taskT2],
      escalated: [taskT2],
      droppedRem: 1,
      droppedEsc: 1,
    });
    const after = await batchB(now);
    // T2 đã `markRemindedMany` (lô trên) + đã `escalated_at` ⇒ chỉ còn T ở cả hai vòng.
    expect(after).toEqual({
      reminded: [taskT],
      escalated: [taskT],
      droppedRem: 0,
      droppedEsc: 0,
    });
  });
});
