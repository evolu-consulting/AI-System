// [AUDIT] · quyết bước duyệt HĐ qua đường chung `/review-tasks/:id/decision` ⇒ engine báo `onDecided.contracts` ⇒ `stage_decided` (cùng hàm
// repo của thẻ) ⇒ «Hồ sơ duyệt» có dòng. Người quyết = người được giao ≠ người tạo HĐ. Chéo tenant: run của tenant khác ⇒ không ghi.
// Hồ sơ đánh dấu «duyệt thay» khi có `approval_override` cùng task × người. DB thật (pool hub_api, RLS gói).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { contracts, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { createPackUow } from "../../kit/adapters/pack-uow";
import { backfillDecisions, recordEngineDecision } from "../application/approval-decided.usecase";
import { approvalEngineRepo } from "./approval-engine.repo";
import { sweepRepo } from "./approval-sweep.repo";

let o: Sql;
let db: Db;
let T = "";
let T2 = "";
let CREATOR = "";
let DECIDER = "";
let CIDS: string[] = [];

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [T, T2] = (await tenants(o, 2, 1511)) as [string, string];
  [CREATOR, DECIDER] = (await users(o, T, 2, { from: 1511 })) as [string, string];
  CIDS = await contracts(o, T, 3, { from: 1511, createdBy: CREATOR, status: "draft" });
  db = createDb(urls().hubApi, { max: 4 });
}, 60_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

const uow = () =>
  createPackUow(db, "contracts", (tx, tid) => ({
    approvalEngine: approvalEngineRepo(tx, tid),
    sweep: sweepRepo(tx, tid),
  }));

/** Lượt engine của HĐ (như sau Gửi duyệt): `approvals.engine_run_id = run`, `contracts.run_id = lượt`. */
async function engineApproval(cid: string): Promise<{ aid: string; run: string }> {
  const aid = crypto.randomUUID();
  const run = crypto.randomUUID();
  await o`insert into contracts.approvals (id, tenant_id, contract_id, status, started_by, mode, engine_run_id)
    values (${aid}, ${T}, ${cid}, 'level1', ${CREATOR}, 'engine', ${run})`;
  await o`update contracts.contracts set run_id = ${aid} where id = ${cid}`;
  return { aid, run };
}
const ev = (tenantId: string, run: string, taskId: string) => ({
  tenantId,
  packKey: "contracts",
  runId: run,
  taskId,
  stageKey: "truong-phong",
  result: "fail" as const,
  feedback: "Thiếu phụ lục",
  actor: DECIDER,
  evidenceId: null,
});
const rows = async (cid: string) =>
  o`select actor_user_id::text as actor, data ->> 'action' as action, data ->> 'feedback' as fb, data ->> 'stage' as stage
    from contracts.contract_events where contract_id = ${cid} and type = 'stage_decided'`;

describe("[AUDIT] quyết qua đường chung ⇒ lịch sử HĐ", () => {
  it("người được giao (≠ người tạo) Trả lại qua Việc của tôi ⇒ đúng 1 stage_decided; gọi lại ⇒ vẫn 1", async () => {
    const cid = CIDS[0] as string;
    const { run } = await engineApproval(cid);
    const hook = recordEngineDecision(uow());
    const t = crypto.randomUUID();
    await hook(ev(T, run, t));
    await hook(ev(T, run, t));
    expect([...(await rows(cid))]).toEqual([
      { actor: DECIDER, action: "return", fb: "Thiếu phụ lục", stage: "truong-phong" },
    ]);
  });

  it("chéo tenant: run của tenant A gửi với tenant B ⇒ không ghi gì", async () => {
    const cid = CIDS[1] as string;
    const { run } = await engineApproval(cid);
    await recordEngineDecision(uow())(ev(T2, run, crypto.randomUUID()));
    expect([...(await rows(cid))]).toEqual([]);
  });

  it("hồ sơ: có approval_override cùng task × người ⇒ override=true; tenant khác không thấy", async () => {
    const cid = CIDS[2] as string;
    const { aid, run } = await engineApproval(cid);
    const t = crypto.randomUUID();
    await o`insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
      values (${T}, ${cid}, 'approval_override', ${DECIDER},
        jsonb_build_object('run_id', ${aid}::text, 'engine_run_id', ${run}::text, 'task_id', ${t}::text, 'stage', 's0', 'action', 'approve'))`;
    await recordEngineDecision(uow())({ ...ev(T, run, t), result: "pass" });
    const mine = await uow().system(
      T,
      async (r) => (await r.approvalEngine.decisionsOf?.(cid)) ?? [],
    );
    expect(mine.map((x) => [x.action, x.override])).toEqual([["approve", true]]);
    const other = await uow().system(
      T2,
      async (r) => (await r.approvalEngine.decisionsOf?.(cid)) ?? [],
    );
    expect(other).toEqual([]);
  });

  it("đường bù: engine có quyết mà HĐ thiếu dòng ⇒ vòng quét ghi bù đúng lúc quyết; chạy lại ⇒ 0; tenant khác ⇒ 0", async () => {
    const [cid] = await contracts(o, T, 1, { from: 1561, createdBy: CREATOR, status: "draft" });
    const { run } = await engineApproval(cid as string);
    const t = crypto.randomUUID();
    const at = "2026-11-01T03:04:05.000000Z";
    const port = {
      decidedTasksOf: async (tenantId: string, runs: readonly string[]) =>
        tenantId === T && runs.includes(run) ? [{ ...ev(T, run, t), at }] : [],
    };
    expect(await backfillDecisions({ uow: uow(), port }, T, 500)).toBe(1);
    expect(await backfillDecisions({ uow: uow(), port }, T, 500)).toBe(0);
    expect(await backfillDecisions({ uow: uow(), port }, T2, 500)).toBe(0);
    const [r] =
      await o`select actor_user_id::text as actor, to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') as at
      from contracts.contract_events where contract_id = ${cid as string} and type = 'stage_decided'`;
    expect(r).toEqual({ actor: DECIDER, at: "2026-11-01T03:04:05" });
  });
});
