// CR-127 · E3c · spec §5.2 (Q18) · hub 0133 · int: bước chỉ cấu hình `escalate.user_id` ⇒ task có `escalate_user_id`; quá hạn ⇒ vòng
// chuyển cấp thêm hàng người `via='escalated'` + báo người đó (quyết được trên thẻ); chuyển cấp nhóm như cũ; CHECK
// `review_tasks_remind_ck` chặn có hạn mà không đích / có cả hai đích. Đồng hồ giả (`escalateBatch` trực tiếp), không ngủ.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { withHubScope } from "@ai/db/hub-scope";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../../lib/db";
import { createHubUow, systemOnly } from "../../adapters/hub-uow";
import { insertTask } from "../../core/core.repo";
import { loadTaskDetails } from "../../core/task-view";
import { type ClaimWorld, claimWorld, groupTask } from "../../testing/claim-seed";
import { escalateBatch } from "./escalate-task.usecase";

let o: Sql;
let db: Db;
let w: ClaimWorld;
const H = 3_600_000;

async function newTask(escalate: Record<string, unknown>) {
  const s = await groupTask(o, w, w.G, { kind: "review", group_id: null, escalate });
  await o`update hub.review_tasks set status = 'closed', result = 'cancelled' where id = ${s.taskId}`;
  return withHubScope(db, { kind: "system" }, (tx) =>
    insertTask(tx, {
      tenantId: w.T,
      runId: s.runId,
      stageRunId: s.stageRunId,
      kind: "review",
      outputId: s.outputId,
      remindAt: new Date(Date.now() + 24 * H),
      userIds: [w.A],
      groupId: null,
    }),
  );
}
const escalate = (h: number) =>
  systemOnly(
    createHubUow(db, { clock: () => new Date(), publish: async () => {} } as never),
  ).systemBatch((r) => escalateBatch(r, new Date(Date.now() + h * H), 1000));
const rows = async (taskId: string) => [
  ...(await o<
    { user_id: string | null; group_id: string | null }[]
  >`select user_id::text, group_id::text
    from hub.review_task_assignees where task_id = ${taskId} and via = 'escalated'`),
];
const canAct = (u: string, taskId: string) =>
  withHubScope(db, { kind: "user", userId: u, tenantId: w.T }, async (tx) => {
    const [d] = await loadTaskDetails(
      tx,
      { userId: u, tenantId: w.T, role: "member", groupIds: new Set(w.groupsOf.get(u) ?? []) },
      [taskId],
    );
    return d?.can_act;
  });

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  w = await claimWorld(o, 1274);
  db = connectDb(urls().hubApi, 4);
}, 300_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-127 E3c · chuyển cấp tới một người", () => {
  it("bước chỉ có user_id ⇒ quá hạn thêm hàng người + báo người đó; chưa quá hạn ⇒ chưa", async () => {
    const t = await newTask({ after_h: 24, user_id: w.X });
    const [c] = await o<{ u: string | null; g: string | null; at: Date | null }[]>`
      select escalate_user_id::text as u, escalate_group_id::text as g, escalate_at as at from hub.review_tasks
      where id = ${t}`;
    expect([c?.u, c?.g, c?.at !== null]).toEqual([w.X, null, true]);
    expect(await canAct(w.X, t)).toBe(false);
    await escalate(1);
    expect(await rows(t)).toEqual([]);
    await escalate(25);
    expect(await rows(t)).toEqual([{ user_id: w.X, group_id: null }]);
    expect(await canAct(w.X, t)).toBe(true);
    const n =
      await o`select 1 from hub.process_notices where task_id = ${t} and user_id = ${w.X} and kind = 'escalated'`;
    expect(n.length).toBe(1);
  });

  it("chuyển cấp nhóm vẫn như cũ", async () => {
    const t = await newTask({ after_h: 24, group_id: w.G0 });
    await escalate(25);
    expect(await rows(t)).toEqual([{ user_id: null, group_id: w.G0 }]);
  });

  it("CHECK: có hạn mà không đích / có cả nhóm lẫn người ⇒ bị chặn", async () => {
    const t = await newTask({ after_h: 24, user_id: w.X });
    const bad = async (q: Promise<unknown>) =>
      (await q.then(() => "ok").catch((e) => e.code)) as string;
    expect(await bad(o`update hub.review_tasks set escalate_user_id = null where id = ${t}`)).toBe(
      "23514",
    );
    expect(
      await bad(o`update hub.review_tasks set escalate_group_id = ${w.G0} where id = ${t}`),
    ).toBe("23514");
  });
});
