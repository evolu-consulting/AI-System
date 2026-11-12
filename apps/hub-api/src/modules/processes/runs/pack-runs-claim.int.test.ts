// CR-127 · RA2 · int (DB thật, role hub_api): `stepsView` (nguồn của thẻ duyệt HĐ / trang yêu cầu) mang `claim`/`need`/`can_reassign`
// của task mở theo người xem — trưởng phòng true, thành viên thường false, người ngoài phòng không thấy việc (không quyết được).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../lib/db";
import type { ProcessDeps } from "../core/ports";
import { type ClaimWorld, claimWorld, groupTask } from "../testing/claim-seed";
import { openTasksOf, stepsView } from "./pack-runs-view";

let o: Sql;
let db: Db;
let w: ClaimWorld;
const deps = () =>
  ({
    db,
    config: {
      user: async (uid: string) => ({ active: true, groupIds: new Set(w.groupsOf.get(uid) ?? []) }),
    },
  }) as unknown as ProcessDeps;
const taskOf = async (userId: string, runId: string, role = "member") =>
  (await stepsView(deps(), { userId, tenantId: w.T, role }, runId))?.steps[0]?.task;

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  w = await claimWorld(o, 1273);
  db = connectDb(urls().hubApi, 6);
}, 300_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-127 RA2 · stepsView.task mang nhận việc", () => {
  it("việc nhóm: trưởng phòng can_reassign true, thành viên false; người giữ thấy claim.state", async () => {
    const { runId, taskId } = await groupTask(o, w, w.G);
    const h = await taskOf(w.H, runId);
    const a = await taskOf(w.A, runId);
    expect([h?.id, h?.need, h?.can_reassign, h?.claim]).toEqual([
      taskId,
      "one",
      true,
      { state: "unclaimed" },
    ]);
    expect([a?.can_act, a?.need, a?.can_reassign]).toEqual([true, "one", false]);
    await o`update hub.review_tasks set claimed_by = ${w.A}, claimed_at = now() where id = ${taskId}`;
    expect((await taskOf(w.A, runId))?.claim?.state).toBe("mine");
    const b = await taskOf(w.B, runId);
    expect([b?.claim?.state, b?.claim?.by?.id, b?.can_reassign]).toEqual(["other", w.A, false]);
    expect((await taskOf(w.TA, runId, "tenant_admin"))?.can_reassign).toBe(true);
  });

  it("RA3 · need=all: votes {1,2}; bằng chứng: evidence_mode; việc thường không có votes", async () => {
    const { runId, taskId } = await groupTask(o, w, w.G, {
      kind: "review",
      group_id: null,
      evidence: "opinion_plus",
    });
    await o`update hub.review_tasks set need = 'all' where id = ${taskId}`;
    await o`insert into hub.review_task_assignees (tenant_id, task_id, user_id, via, depth)
      values (${w.T}, ${taskId}, ${w.A}, 'initial', 0), (${w.T}, ${taskId}, ${w.B}, 'initial', 0)`;
    await o`insert into hub.review_task_votes (task_id, tenant_id, user_id, result)
      values (${taskId}, ${w.T}, ${w.A}, 'pass')`;
    const b = await taskOf(w.B, runId);
    expect([b?.votes, b?.evidence_mode, b?.need]).toEqual([
      { done: 1, total: 2 },
      "opinion_plus",
      "all",
    ]);
    const plain = await groupTask(o, w, w.G);
    const p = await taskOf(w.A, plain.runId);
    expect([p?.votes, p?.evidence_mode, p?.delegated_from]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("RA3 · uỷ quyền còn hiệu lực ⇒ delegated_from (tên A); hết hạn ⇒ không còn quyền", async () => {
    const { runId, taskId } = await groupTask(o, w, w.G);
    await o`insert into hub.delegations (tenant_id, from_user_id, to_user_id, from_at, to_at, kinds, created_by)
      values (${w.T}, ${w.A}, ${w.X}, now() - interval '1 hour', now() + interval '1 hour', array['approve'], ${w.A})`;
    await o`insert into hub.review_task_assignees (tenant_id, task_id, user_id, via, on_behalf_of, depth)
      values (${w.T}, ${taskId}, ${w.X}, 'delegated', ${w.A}, 0)`;
    const x = await taskOf(w.X, runId);
    expect([x?.can_act, x?.delegated_from?.id]).toEqual([true, w.A]);
    expect(x?.delegated_from?.display_name).toBeTruthy();
    await o`update hub.delegations set from_at = now() - interval '3 hours', to_at = now() - interval '1 hour'
      where tenant_id = ${w.T} and from_user_id = ${w.A} and to_user_id = ${w.X}`;
    const gone = await taskOf(w.X, runId);
    expect([gone?.can_act, gone?.delegated_from]).toEqual([false, undefined]);
  });

  it("«Việc của tôi» · openTasksOf mang delegated_from (MỘT câu); hết hạn uỷ quyền ⇒ không còn", async () => {
    const { runId, taskId } = await groupTask(o, w, w.G);
    await o`update hub.process_runs set pack_key = 'contracts', pack_record_id = gen_random_uuid() where id = ${runId}`;
    await o`insert into hub.delegations (tenant_id, from_user_id, to_user_id, from_at, to_at, kinds, created_by)
      values (${w.T}, ${w.A}, ${w.X}, now() - interval '1 hour', now() + interval '1 hour', array['approve'], ${w.A})`;
    await o`insert into hub.review_task_assignees (tenant_id, task_id, user_id, via, on_behalf_of, depth)
      values (${w.T}, ${taskId}, ${w.X}, 'delegated', ${w.A}, 0)`;
    const caller = { userId: w.X, tenantId: w.T, role: "member" };
    const mine = (await openTasksOf(deps(), caller, "contracts")).find((t) => t.task_id === taskId);
    expect(mine?.delegated_from?.id).toBe(w.A);
    expect(mine?.delegated_from?.display_name).toBeTruthy();
    await o`update hub.delegations set from_at = now() - interval '3 hours', to_at = now() - interval '1 hour'
      where tenant_id = ${w.T} and from_user_id = ${w.A} and to_user_id = ${w.X}`;
    const gone = (await openTasksOf(deps(), caller, "contracts")).find((t) => t.task_id === taskId);
    expect(gone?.delegated_from).toBeUndefined();
  });
});
