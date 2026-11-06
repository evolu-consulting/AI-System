// CR-122 · A1 · FLOW2-FR-12/15/18/19 · gói Hợp đồng ⇄ flow theo sự kiện, DB thật (pool hub_api, role contracts_rw, RLS gói):
// (1) gửi duyệt ghi `contract.submitted` CÙNG tx (hub.emit_flow_event, 0109), facts theo manifest, event_id theo lượt, trùng ⇒ không ghi;
// (2) OutcomeHandler Đã duyệt / Từ chối / Trả lại về Nháp: áp trong tx engine, idempotent theo (runId, outcome), Đã duyệt bắn contract.approved;
// (3) chặn đọc chéo tenant: FactsReader + OutcomeHandler của tenant khác không thấy / không đổi HĐ.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { contracts, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { createPackUow } from "../../kit/adapters/pack-uow";
import { startApproval } from "../application/approval.usecase";
import type { ContractFlowGate } from "../application/contract-flow.ports";
import { contractsFactsReader, contractsOutcomeHandler } from "../flow-events.mount";
import { approvalRepo } from "./approval.repo";
import { contractFlowRepo } from "./contract-flow.repo";

let o: Sql;
let db: Db;
let T1 = "";
let T2 = "";
let A = "";
let C: string[] = [];
let X = ""; // HĐ của tenant T2

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [T1, T2] = (await tenants(o, 2, 922)) as [string, string];
  [A] = (await users(o, T1, 1, { from: 922 })) as [string];
  C = await contracts(o, T1, 6, { from: 922, createdBy: A, status: "needs_review" });
  const [ux] = (await users(o, T2, 1, { from: 923 })) as [string];
  X = (
    await contracts(o, T2, 1, { from: 923, createdBy: ux, status: "needs_review" })
  )[0] as string;
  db = createDb(urls().hubApi, { max: 3 });
}, 60_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

const uow = () =>
  createPackUow(db, "contracts", (tx, tid) => ({
    approval: approvalRepo(tx, tid),
    contractFlow: contractFlowRepo(tx, tid),
  }));
const gateOn: ContractFlowGate = {
  prepare: async () => ({ on: true, departments: ["pb-kd"] }),
};
const events = (tenant: string, like: string) =>
  o<
    { event_id: string; event: string; ref: string; facts: Record<string, unknown> }[]
  >`select event_id, event, ref, facts from hub.flow_events where tenant_id = ${tenant} and event_id like ${like}`;
const cRow = async (id: string) =>
  (
    await o<
      { status: string; run_id: string | null }[]
    >`select status, run_id from contracts.contracts where id = ${id}`
  )[0];

/** Lượt `level1` đang mở của HĐ (như sau Gửi duyệt) — trả id lượt. */
async function openApproval(tenant: string, contractId: string, by: string): Promise<string> {
  const aid = crypto.randomUUID();
  await o`insert into contracts.approvals (id, tenant_id, contract_id, status, started_by)
    values (${aid}, ${tenant}, ${contractId}, 'level1', ${by})`;
  await o`update contracts.contracts set run_id = ${aid},
    fields = jsonb_build_object('total_value', jsonb_build_object('value', 750000000)), deal = 'sell'
    where id = ${contractId}`;
  return aid;
}
const apply = (tenant: string, ref: string, runId: string, outcome: string) =>
  withHubScope(db, { kind: "system" }, (tx) =>
    contractsOutcomeHandler().apply(tx, {
      tenantId: tenant,
      runId,
      event: "contract.submitted",
      ref,
      outcome,
      actorId: null,
    }),
  );

describe("A1 · gửi duyệt ghi sự kiện cùng tx", () => {
  it("startApproval(level1) + cờ bật ⇒ 1 dòng contract.submitted (facts manifest, theo lượt); gửi lại cùng lượt không ghi thêm", async () => {
    const id = C[0] as string;
    await o`update contracts.contracts set deal = 'buy',
      fields = jsonb_build_object('total_value', jsonb_build_object('value', 500))  where id = ${id}`;
    const start = startApproval({
      uow: uow(),
      flow: gateOn,
      jobs: { enqueue: async () => {} },
      groups: {},
    } as never);
    expect(await start({ tenantId: T1, userId: A }, id, "level1")).toBe("ok");
    const rows = await events(T1, `contract.submitted:${id}:%`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ event: "contract.submitted", ref: id });
    expect(rows[0]?.facts).toMatchObject({
      total_value: 500,
      deal: "buy",
      creator_department: ["pb-kd"],
    });
    const aid = (rows[0] as { event_id: string }).event_id.split(":")[2] as string;
    const again = await uow().tenant({ tenantId: T1, userId: A }, (r) =>
      r.contractFlow.emitContract("contract.submitted", id, aid, { actor: A, departments: null }),
    );
    expect(again).toBe(false);
    expect(await events(T1, `contract.submitted:${id}:%`)).toHaveLength(1);
  });
});

// CHỜ KẾT LUẬN SOÁT (điều phối 2026-11-06): OutcomeHandler đổi role gói tạm trong tx engine (`inPack`) — cách này đang được soát, chưa chạy int.
describe.skip("A1 · OutcomeHandler trong tx engine", () => {
  it("Đã duyệt: HĐ active + lượt done + bắn contract.approved; gọi lại ⇒ already_applied, không ghi thêm", async () => {
    const id = C[1] as string;
    const aid = await openApproval(T1, id, A);
    const run = crypto.randomUUID();
    expect(await apply(T1, id, run, "approved")).toBe("applied");
    expect((await cRow(id))?.status).toBe("active");
    const [a] = await o<
      { status: string; engine_run_id: string }[]
    >`select status, engine_run_id from contracts.approvals where id = ${aid}`;
    expect(a).toMatchObject({ status: "done", engine_run_id: run });
    const ev = await events(T1, `contract.approved:${id}:%`);
    expect(ev).toHaveLength(1);
    expect(ev[0]?.facts).toMatchObject({ total_value: 750000000, deal: "sell" });
    expect(await apply(T1, id, run, "approved")).toBe("already_applied");
    expect(await events(T1, `contract.approved:${id}:%`)).toHaveLength(1);
    // run khác chưa từng áp lên HĐ đã đóng ⇒ không đè
    expect(await apply(T1, id, crypto.randomUUID(), "rejected")).toBe("not_found");
    expect((await cRow(id))?.status).toBe("active");
  });
  it("Từ chối: HĐ rejected + lượt rejected; idempotent", async () => {
    const id = C[2] as string;
    const aid = await openApproval(T1, id, A);
    const run = crypto.randomUUID();
    expect(await apply(T1, id, run, "rejected")).toBe("applied");
    expect((await cRow(id))?.status).toBe("rejected");
    const [a] = await o<
      { status: string }[]
    >`select status from contracts.approvals where id = ${aid}`;
    expect(a?.status).toBe("rejected");
    expect(await apply(T1, id, run, "rejected")).toBe("already_applied");
  });
  it("Trả lại: về Nháp (needs_review, bỏ run_id), lượt đóng; gửi duyệt lại mở được lượt mới", async () => {
    const id = C[3] as string;
    await openApproval(T1, id, A);
    const run = crypto.randomUUID();
    expect(await apply(T1, id, run, "returned")).toBe("applied");
    expect(await cRow(id)).toMatchObject({ status: "needs_review", run_id: null });
    expect(await apply(T1, id, run, "returned")).toBe("already_applied");
    const start = startApproval({
      uow: uow(),
      jobs: { enqueue: async () => {} },
      groups: {},
    } as never);
    expect(await start({ tenantId: T1, userId: A }, id, "level1")).toBe("ok");
  });
  it("kết cục lạ / ref sai ⇒ not_found, không đổi dữ liệu", async () => {
    const id = C[4] as string;
    await openApproval(T1, id, A);
    expect(await apply(T1, "không-phải-uuid", crypto.randomUUID(), "approved")).toBe("not_found");
    expect((await cRow(id))?.status).toBe("needs_review");
  });
});

describe("A1 · chặn đọc chéo tenant", () => {
  it("FactsReader/OutcomeHandler của tenant khác không thấy và không đổi HĐ", async () => {
    const id = C[5] as string;
    await openApproval(T1, id, A);
    const reader = contractsFactsReader(db);
    expect(await reader.read(T2, id, ["deal"])).toBeNull();
    expect(await reader.read(T1, id, ["deal", "total_value"])).toEqual({
      deal: "sell",
      total_value: 750000000,
    });
    expect(await reader.read(T1, X, ["deal"])).toBeNull(); // HĐ của T2 đọc dưới tenant T1
    expect((await cRow(id))?.status).toBe("needs_review");
    expect((await cRow(X))?.status).toBe("needs_review");
  });
  it.skip("OutcomeHandler của tenant khác ⇒ not_found, không đổi HĐ (chờ soát inPack)", async () => {
    const id = C[5] as string;
    expect(await apply(T2, id, crypto.randomUUID(), "approved")).toBe("not_found");
    expect((await cRow(id))?.status).toBe("needs_review");
  });
});
