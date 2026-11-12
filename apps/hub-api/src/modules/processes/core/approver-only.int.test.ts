// CR-127 · Z2 · bước Duyệt chỉ có người (`after.approver_user_id`, không phòng) — int (DB thật, role `hub_api`): task mở đúng cho người đó
// (hàng `via='initial'`, need='head'), người khác không quyết được; người duyệt bị khoá ⇒ task không giao đích danh.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { withHubScope } from "@ai/db/hub-scope";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../lib/db";
import { type ClaimWorld, claimWorld, groupTask } from "../testing/claim-seed";
import { insertTask } from "./core.repo";
import { loadTaskDetails } from "./task-view";

let o: Sql;
let db: Db;
let w: ClaimWorld;

async function openTask(approver: string) {
  const s = await groupTask(o, w, w.G, {
    kind: "review",
    group_id: null,
    approver_user_id: approver,
  });
  await o`update hub.review_tasks set status = 'closed', result = 'cancelled' where id = ${s.taskId}`;
  return withHubScope(db, { kind: "system" }, (tx) =>
    insertTask(tx, {
      tenantId: w.T,
      runId: s.runId,
      stageRunId: s.stageRunId,
      kind: "review",
      outputId: s.outputId,
      remindAt: new Date(Date.now() + 24 * 3_600_000),
      userIds: [],
      groupId: null,
    }),
  );
}
const card = (u: string, taskId: string) =>
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

describe("CR-127 Z2 · bước Duyệt chỉ có người", () => {
  it("giao đích danh người duyệt (need='head'); người khác không quyết được", async () => {
    const t = await openTask(w.A);
    const rows = await o<{ user_id: string | null; group_id: string | null; via: string }[]>`
      select user_id::text, group_id::text, via from hub.review_task_assignees where task_id = ${t}`;
    expect([...rows]).toEqual([{ user_id: w.A, group_id: null, via: "initial" }]);
    const [n] = await o<{ need: string; g: string | null }[]>`
      select need, assignee_group_id::text as g from hub.review_tasks where id = ${t}`;
    expect([n?.need, n?.g]).toEqual(["head", null]);
    expect(await card(w.A, t)).toBe(true);
    expect(await card(w.X, t)).toBe(false);
  });

  it("người duyệt bị khoá ⇒ không giao đích danh (không có hàng nào)", async () => {
    await o`update admin.users set locked_by_tenant = true where id = ${w.B}`;
    const t = await openTask(w.B);
    const rows = await o`select 1 from hub.review_task_assignees where task_id = ${t}`;
    expect(rows.length).toBe(0);
  });
});
