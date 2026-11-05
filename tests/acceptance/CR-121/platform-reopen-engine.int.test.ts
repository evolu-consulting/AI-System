// CR-121 Q-3 · platform_admin dùng CHÍNH 3 route engine `POST /pack/contracts/contracts/:id/approval/{reopen,retry,cancel-reopen}`
// cho công ty đích: thiếu `?tenant_id` ⇒ 400 · lý do rỗng/> 500 ⇒ 400 · `tenant_id` không khớp HĐ ⇒ 404 · thành công ⇒ 200 và lịch sử
// HĐ có dòng ý định (`platform_approval_op`, ghi TRƯỚC thao tác) + kết quả (`platform_approval_result`) kèm actor/tenant/HĐ/lý do.
// Hạ tầng CF (hub THẬT, cờ engine bật). Người: A (owner gói), B (editor), P (padmin = platform_admin).

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { type CtxCf, caller, startCf } from "../CF/_cf";
import { approval, CBASE, seedContract, toLevel1 } from "../HD3/_hd3";
import { packsPath } from "../N1/_support/n1";
import { type Json, PA, T, waitFor } from "../P-d/_support/pd";

let c: CtxCf;
beforeAll(async () => {
  c = await startCf();
  // Công ty beta bật gói (để "tenant_id không khớp HĐ" ra 404 chứ không phải 403 gói tắt); chờ cache cấu hình nạp bằng chính lời gọi.
  expect((await c.admin.call("PUT", packsPath(T.beta, "contracts"))).status).toBe(200);
  const probe = await waitFor(
    () => call(randomUUID(), "reopen", T.beta, { reason: "dò" }),
    (r) => r.status !== 403,
    15_000,
  );
  expect(probe?.status).toBe(404);
}, 180_000);
afterAll(async () => {
  await c?.stop();
});

const SMALL = 1000;
const BIG = 600_000_000;
const call = (id: string, op: string, tenant: string | null, body: unknown) =>
  c.call("P", "POST", `${CBASE}/${id}/approval/${op}${tenant ? `?tenant_id=${tenant}` : ""}`, body);
const row = async (aid: string): Promise<Json> =>
  (
    await c.sql<
      Json[]
    >`select status, engine_run_id::text as run from contracts.approvals where id = ${aid}`
  )[0] as Json;
const events = async (id: string) => [
  ...(await c.sql<Json[]>`select type, tenant_id::text as tenant, contract_id::text as contract,
      actor_user_id::text as actor, data from contracts.contract_events
    where contract_id = ${id} and type in ('platform_approval_op', 'platform_approval_result') order by at, id`),
];
const stepOpen = (id: string) =>
  waitFor(
    async () => ((await approval(c, "A", id)).json as Json)?.steps?.[0]?.status,
    (s) => s === "open",
    10_000,
  );

/** Lượt engine kẹt: run bị huỷ ngoài luồng ⇒ sweep giữ engine + `needs_reopen` (khuôn CF/fix-pack). */
async function stalled(n: number): Promise<string> {
  const id = await seedContract(c, n);
  const aid = (await toLevel1(c, id, BIG)).runId;
  const run = (await row(aid)).run as string;
  await stepOpen(id);
  expect(await c.port.cancelSys(T.acme, run)).toBe(true);
  await c.sweepOnce();
  return id;
}

/** Lượt engine `needs_decision` (khuôn CF/eng-reliable). */
async function needsDecision(n: number): Promise<string> {
  const id = await seedContract(c, n);
  const aid = (await toLevel1(c, id, SMALL)).runId;
  await stepOpen(id);
  const run = (await row(aid)).run as string;
  await c.sql`update contracts.approvals set status = 'level2' where id = ${aid}`;
  expect(await c.port.act(caller(PA.B), run, { stage: "s0" }, { result: "pass" })).toBe("ok");
  await waitFor(
    async () =>
      (await c.sql<Json[]>`select status from hub.process_runs where id = ${run}`)[0] as Json,
    (r) => r?.status === "needs_decision",
    15_000,
  );
  await c.sql`update contracts.approvals set status = 'level1' where id = ${aid}`;
  return id;
}

type Op = "reopen" | "retry" | "cancel-reopen";

/** 400 thiếu tenant_id / lý do sai · 404 tenant không khớp HĐ · 200 + audit ý định/kết quả. */
async function journey(op: Op, id: string): Promise<void> {
  const reason = "Khách báo kẹt duyệt, platform xử lý hộ";
  expect((await call(id, op, null, { reason })).status).toBe(400);
  expect((await call(id, op, T.acme, {})).status).toBe(400);
  expect((await call(id, op, T.acme, { reason: "   " })).status).toBe(400);
  expect((await call(id, op, T.acme, { reason: "x".repeat(501) })).status).toBe(400);
  expect((await call(id, op, T.beta, { reason })).status).toBe(404);
  expect(await events(id)).toEqual([]); // chưa thao tác hợp lệ nào ⇒ chưa có dấu vết
  expect((await call(id, op, T.acme, { reason })).status).toBe(200);
  const ev = await events(id);
  expect(ev.map((e) => e.type)).toEqual(["platform_approval_op", "platform_approval_result"]);
  expect(ev[0]).toMatchObject({
    tenant: T.acme,
    contract: id,
    actor: PA.P.id,
    data: { op, reason, actor_role: "platform_admin" },
  });
  expect(ev[1]).toMatchObject({ actor: PA.P.id, data: { op, outcome: "ok" } });
}

describe("CR-121 Q-3 · platform_admin trên 3 route engine", () => {
  it("reopen: platform_admin thiếu tenant_id 400, lý do sai 400, tenant không khớp HĐ 404, thành công 200 có audit", async () => {
    await journey("reopen", await stalled(741));
  }, 120_000);
  it("retry: platform_admin thiếu tenant_id 400, lý do sai 400, tenant không khớp HĐ 404, thành công 200 có audit", async () => {
    await journey("retry", await needsDecision(742));
  }, 120_000);
  it("cancel-reopen: platform_admin thiếu tenant_id 400, lý do sai 400, tenant không khớp HĐ 404, thành công 200 có audit", async () => {
    await journey("cancel-reopen", await needsDecision(743));
  }, 120_000);
});
