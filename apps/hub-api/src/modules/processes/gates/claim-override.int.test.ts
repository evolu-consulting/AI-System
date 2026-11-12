// CR-127 · FIX-OV · CR-113 · int (DB thật, role `hub_api`): người Toàn quyền (Group "cũng quyết" `after.also_group_ids`, ngoài
// nhóm duyệt) Nhận việc được ⇒ thẻ (`stepsView`) cho quyết + cờ `override` (nguồn ghi "duyệt thay" của thẻ HĐ); thành viên nhóm
// lúc đó không quyết được (can_act=false, decision 409); người ngoài nhóm không Toàn quyền vẫn 404.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../lib/db";
import type { ProcessDeps } from "../core/ports";
import { stepsView } from "../runs/pack-runs-view";
import { type ClaimWorld, claimWorld, groupTask } from "../testing/claim-seed";
import { ClaimService } from "./claim.service";
import { GateService } from "./gates.service";

let o: Sql;
let db: Db;
let w: ClaimWorld;

function deps(): ProcessDeps {
  return {
    db,
    config: {
      user: async (uid: string) => ({ active: true, groupIds: new Set(w.groupsOf.get(uid) ?? []) }),
    },
    now: () => new Date("2026-11-11T08:00:00.000Z"),
    log: { warn: () => {}, info: () => {}, error: () => {} },
  } as unknown as ProcessDeps;
}
const who = (userId: string) => ({ userId, tenantId: w.T, role: "member" }) as never;
const err = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    const x = e as { code?: string; status?: number };
    return { code: x.code, status: x.status };
  }
};
const card = async (userId: string, runId: string) =>
  (await stepsView(deps(), { userId, tenantId: w.T, role: "member" }, runId))?.steps[0]?.task;

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  w = await claimWorld(o, 1275);
  // X = Toàn quyền: chỉ thuộc Group "cũng quyết" (OWN = G0 ở đây), KHÔNG thuộc phòng G được giao.
  w.groupsOf.set(w.X, [w.G0]);
  db = connectDb(urls().hubApi, 6);
}, 300_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("FIX-OV · Toàn quyền Nhận việc rồi duyệt thay", () => {
  it("Toàn quyền nhận được ⇒ quyết được + override; thành viên nhóm bị chặn; ngoài nhóm không Toàn quyền 404", async () => {
    const { runId, taskId } = await groupTask(o, w, w.G, {
      kind: "review",
      group_id: w.G,
      also_group_ids: [w.G0],
    });
    const claims = new ClaimService(deps());
    expect((await err(claims.claim(who(w.S), taskId)))?.status).toBe(404);
    const c = await claims.claim(who(w.X), taskId);
    expect([c.claim.state, c.claim.by?.id]).toEqual(["mine", w.X]);
    const x = await card(w.X, runId);
    expect([x?.claim?.state, x?.can_act, x?.override]).toEqual(["mine", true, true]);
    // Thành viên phòng khi Toàn quyền đang giữ: thẻ "X đang xử lý" (claim other ⇒ ClaimBar khoá nút); quyết thử ⇒ 409.
    const a = await card(w.A, runId);
    expect([a?.claim?.state, a?.claim?.by?.id, a?.override]).toEqual(["other", w.X, undefined]);
    const d = await err(
      new GateService(deps()).reviewDecision(who(w.A), taskId, { result: "pass" } as never),
    );
    expect([d?.code, d?.status]).toEqual(["TASK_CLAIMED", 409]);
    // Trả về nhóm rồi thành viên nhận lại ⇒ quyết bình thường, không phải duyệt thay.
    expect((await claims.release(who(w.X), taskId)).claim.state).toBe("unclaimed");
    await claims.claim(who(w.A), taskId);
    const a2 = await card(w.A, runId);
    expect([a2?.can_act, a2?.override]).toEqual([true, undefined]);
  });
});
