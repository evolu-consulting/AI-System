// CR-127 · E2 · spec §5.1 · §4.2 · int (DB thật, role `hub_api`): đua nhận việc (hai kết nối — một thắng, người sau 409
// `TASK_CLAIMED{by}`), người khác đã nhận ⇒ thẻ "X đang xử lý" + không quyết được, Trả về nhóm, Giao cho người khác, hạn tự trả
// theo giờ của công ty. Kiểm cả thứ người dùng thấy (`TaskDetail.claim/can_act`), không chỉ dòng DB.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { withHubScope } from "@ai/db/hub-scope";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../lib/db";
import type { ProcessDeps } from "../core/ports";
import { loadTaskDetails } from "../core/task-view";
import { type ClaimWorld, claimWorld, groupTask } from "../testing/claim-seed";
import { ClaimService } from "./claim.service";
import { GateService } from "./gates.service";

let o: Sql;
let db: Db;
let w: ClaimWorld;
const T0 = new Date("2026-11-10T08:00:00.000Z");

function deps(): ProcessDeps {
  return {
    db,
    config: {
      user: async (uid: string) => ({ active: true, groupIds: new Set(w.groupsOf.get(uid) ?? []) }),
    },
    now: () => T0,
    log: { warn: () => {}, info: () => {}, error: () => {} },
  } as unknown as ProcessDeps;
}
const who = (userId: string, role: "member" | "tenant_admin" = "member") =>
  ({ userId, tenantId: w.T, role }) as never;
const claims = () => new ClaimService(deps());
const err = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    const x = e as { code?: string; status?: number; details?: unknown };
    return { code: x.code, status: x.status, details: x.details };
  }
};
const view = (u: string, taskId: string, role: "member" | "tenant_admin" = "member") =>
  withHubScope(db, { kind: "user", userId: u, tenantId: w.T }, async (tx) => {
    const [d] = await loadTaskDetails(
      tx,
      { userId: u, tenantId: w.T, role, groupIds: new Set(w.groupsOf.get(u) ?? []) },
      [taskId],
    );
    return { claim: d?.claim, can_act: d?.can_act, need: d?.need, can_reassign: d?.can_reassign };
  });

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  w = await claimWorld(o, 1271);
  db = connectDb(urls().hubApi, 6);
}, 300_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-127 E2 · Nhận việc", () => {
  it("đua nhận việc: hai kết nối cùng lúc ⇒ một thắng, người sau 409 TASK_CLAIMED kèm tên người đã nhận", async () => {
    const { taskId } = await groupTask(o, w, w.G);
    expect(await view(w.A, taskId)).toEqual({
      claim: { state: "unclaimed" },
      can_act: true,
      need: "one",
      can_reassign: false,
    });
    const res = await Promise.allSettled([
      claims().claim(who(w.A), taskId),
      claims().claim(who(w.B), taskId),
    ]);
    const won = res.filter((r) => r.status === "fulfilled");
    const lost = res.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect([won.length, lost.length]).toEqual([1, 1]);
    const winner = res[0]?.status === "fulfilled" ? w.A : w.B;
    const loser = winner === w.A ? w.B : w.A;
    const e = lost[0]?.reason as { code: string; status: number; details: { by: { id: string } } };
    expect([e.code, e.status, e.details.by.id]).toEqual(["TASK_CLAIMED", 409, winner]);
    // Người thua thấy "X đang xử lý", không quyết được; quyết thử ⇒ 409 TASK_CLAIMED.
    const v = await view(loser, taskId);
    expect([v.claim?.state, v.claim?.by?.id, v.can_act]).toEqual(["other", winner, false]);
    expect([
      (await view(winner, taskId)).claim?.state,
      (await view(winner, taskId)).can_act,
    ]).toEqual(["mine", true]);
    const d = await err(
      new GateService(deps()).reviewDecision(who(loser), taskId, { result: "pass" } as never),
    );
    expect([d?.code, d?.status]).toEqual(["TASK_CLAIMED", 409]);
    // Người giữ nhận lại ⇒ idempotent.
    expect((await claims().claim(who(winner), taskId)).claim.state).toBe("mine");
  });

  it("ngoài phòng ⇒ 404; Trả về nhóm chỉ người giữ (403 NOT_CLAIMER); trả xong người khác nhận được", async () => {
    const { taskId } = await groupTask(o, w, w.G);
    expect((await err(claims().claim(who(w.X), taskId)))?.status).toBe(404);
    await claims().claim(who(w.A), taskId);
    expect((await err(claims().release(who(w.B), taskId)))?.code).toBe("NOT_CLAIMER");
    expect((await claims().release(who(w.A), taskId)).claim.state).toBe("unclaimed");
    expect((await claims().claim(who(w.B), taskId)).claim.by?.id).toBe(w.B);
  });

  it("Giao cho người khác: chỉ trưởng phòng / quản trị; người nhận phải trong phòng", async () => {
    const { taskId } = await groupTask(o, w, w.G);
    await claims().claim(who(w.A), taskId);
    const body = (to: string) => ({ to_user_id: to, note: "bận" });
    expect((await err(claims().reassign(who(w.B), taskId, body(w.B))))?.code).toBe(
      "NOT_GROUP_HEAD",
    );
    expect((await err(claims().reassign(who(w.H), taskId, body(w.X))))?.code).toBe(
      "TARGET_NOT_IN_GROUP",
    );
    const r = await claims().reassign(who(w.H), taskId, body(w.B));
    expect([r.claim.state, r.claim.by?.id]).toEqual(["other", w.B]);
    const [n] = await o<{ kind: string }[]>`select kind from hub.process_notices
      where task_id = ${taskId} and user_id = ${w.B}`;
    expect(n?.kind).toBe("review_requested"); // E3b · người được giao nhận thông báo
    const ta = await claims().reassign(who(w.TA, "tenant_admin"), taskId, body(w.A));
    expect(ta.claim.by?.id).toBe(w.A);
  });

  it("RA1 · can_reassign: trưởng phòng / quản trị true; thành viên thường + người được giao đích danh false; việc đã xong false", async () => {
    const { taskId } = await groupTask(o, w, w.G);
    const can = async (u: string, role: "member" | "tenant_admin" = "member") =>
      (await view(u, taskId, role)).can_reassign;
    expect([await can(w.H), await can(w.A), await can(w.B)]).toEqual([true, false, false]);
    expect(await can(w.TA, "tenant_admin")).toBe(true);
    // Người được giao đích danh (không phải trưởng phòng) vẫn không có quyền chuyển — cùng luật `reassign` (403 NOT_GROUP_HEAD).
    await o`insert into hub.review_task_assignees (tenant_id, task_id, user_id, via, depth)
      values (${w.T}, ${taskId}, ${w.X}, 'initial', 0)`;
    expect(await can(w.X)).toBe(false);
    expect(
      (await err(claims().reassign(who(w.X), taskId, { to_user_id: w.A, note: "x" })))?.code,
    ).toBe("NOT_GROUP_HEAD");
    // Phòng không có trưởng phòng: chỉ quản trị công ty.
    const g0 = await groupTask(o, w, w.G0);
    expect((await view(w.A, g0.taskId)).can_reassign).toBe(false);
    expect((await view(w.TA, g0.taskId, "tenant_admin")).can_reassign).toBe(true);
    // Việc đã xong ⇒ false (trưởng phòng cũng không chuyển được nữa).
    await o`update hub.review_tasks set status = 'closed' where id = ${taskId}`;
    expect(await can(w.H)).toBe(false);
  });

  it("hạn tự trả = lúc nhận + giờ của công ty (tenant_flow_settings.claim_release_h)", async () => {
    await o`insert into hub.tenant_flow_settings (tenant_id, claim_release_h) values (${w.T}, 2)
      on conflict (tenant_id) do update set claim_release_h = 2`;
    const { taskId } = await groupTask(o, w, w.G);
    await claims().claim(who(w.A), taskId);
    const [r] = await o<
      { h: number }[]
    >`select extract(epoch from claim_deadline_at - claimed_at)::int / 3600 as h
      from hub.review_tasks where id = ${taskId}`;
    expect(r?.h).toBe(2);
    await o`update hub.tenant_flow_settings set claim_release_h = 24 where tenant_id = ${w.T}`;
  });
});
