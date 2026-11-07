// CR-124 · q6 · HĐ nhận từ đối tác chỉ có lượt duyệt khi flow nhận ĐÃ SẴN SÀNG (S1), người gây sự kiện chọn chặt (S2), Mở lại phát
// `contract.received` (không `contract.submitted`). DB thật (pool hub_api, role contracts_rw).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { contracts, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { createPackUow } from "../kit/adapters/pack-uow";
import type { PackToolCtx } from "../kit/public";
import { approvalRepo } from "./adapters/approval.repo";
import { contractFlowRepo } from "./adapters/contract-flow.repo";
import { esignRepo } from "./adapters/esign.repo";
import { partnerSendRepo } from "./adapters/partner-send.repo";
import { partnerSendTool } from "./adapters/partner-send.tool";
import { withFlowResend } from "./application/flow-resend.usecase";
import { receiveInbox, receiveStateOf } from "./partner-mailbox.mount";

let o: Sql;
let db: Db;
let A = "";
let B = "";
let UA = "";
let UB: string[] = []; // B: [admin, thành viên, thành viên khoá]
let C: string[] = [];
const FLOW = "0c124000-0000-4000-8000-0000000000c2"; // «Nhận HĐ thường» (hub 0121)

const uow = () =>
  createPackUow(db, "contracts", (tx, t) => ({
    partnerSend: partnerSendRepo(tx, t),
    esign: esignRepo(tx, t),
    approval: approvalRepo(tx, t),
    contractFlow: contractFlowRepo(tx, t),
  }));
const send = (id: string) =>
  partnerSendTool({ uow: uow() }).run(
    { tenantId: A, userId: UA, runId: null, processRunId: null } as PackToolCtx,
    { contract_id: id, send_fields: "total_value" },
  );
const receive = () => receiveInbox(db)(B, 100);
const inboxOf = async () =>
  (
    await o<
      { id: string }[]
    >`select id::text as id from contracts.contracts where tenant_id = ${B} and source = 'partner_inbox'
      order by created_at desc, id desc limit 1`
  )[0]?.id as string;

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [A, B] = (await tenants(o, 2, 1330)) as [string, string];
  [UA] = (await users(o, A, 1, { from: 1330 })) as [string];
  UB = (await users(o, B, 3, { from: 1331 })) as string[];
  await o`update admin.tenants set legal_name = 'Công ty A', tax_code = '0109999998' where id = ${A}`;
  await o`update admin.tenants set legal_name = 'Công ty B', tax_code = '0101234568', directory_listed = true where id = ${B}`;
  C = await contracts(o, A, 4, { from: 1330, createdBy: UA, status: "active" });
  for (const [i, id] of C.entries()) {
    const fid = crypto.randomUUID();
    await o`insert into contracts.files (id, tenant_id, org, file_id, version_id, name, mime, size_bytes, created_by)
      values (${fid}, ${A}, ${`t_${A}`}, ${`f${i}`}, ${`v${i}`}, 'hd.pdf', 'application/pdf', 16, ${UA})`;
    await o`update contracts.contracts set file_id = ${fid}, direction = 'sale', fields = ${o.json({
      buyer_name: { value: "Đối tác" },
      buyer_tax_id: { value: "0101234568" },
      total_value: { value: 100_000_000 },
    } as never)} where id = ${id}`;
  }
  await o`insert into hub.partner_links (from_tenant, to_tenant, requested_at, accepted_at) values (${A}, ${B}, now(), now())`;
  await o`update admin.users set role = 'tenant_admin' where id = ${UB[0] as string}`;
  await o`update admin.users set locked_by_tenant = true where id = ${UB[2] as string}`;
  db = createDb(urls().hubApi, { max: 4 });
}, 60_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-124 q6 · S1 · lượt duyệt của HĐ nhận chỉ khi flow nhận sẵn sàng", () => {
  it("chưa bật cờ / chưa gán flow nhận ⇒ HĐ nhận KHÔNG có lượt duyệt treo (sự kiện vẫn phát để ghi bóng)", async () => {
    await send(C[0] as string);
    expect(await receive()).toBe(1);
    const id = await inboxOf();
    const [k] = await o`select run_id from contracts.contracts where id = ${id}::uuid`;
    expect(k?.run_id).toBeNull();
    const ap = await o`select 1 from contracts.approvals where contract_id = ${id}::uuid`;
    expect(ap).toHaveLength(0);
    const ev =
      await o`select 1 from hub.flow_events where event = 'contract.received' and ref = ${id}`;
    expect(ev).toHaveLength(1);
  });

  it("sẵn sàng + có quản trị ⇒ lượt duyệt FLOW_STARTING và sự kiện có người gây = quản trị", async () => {
    await o`insert into hub.tenant_flow_settings (tenant_id, flow_triggers) values (${B}, true)`;
    await o`insert into hub.company_flows (tenant_id, flow_id, enabled) values (${B}, ${FLOW}, true)`;
    await send(C[1] as string);
    expect(await receive()).toBe(1);
    const id = await inboxOf();
    const [ap] =
      await o`select status, mode, feedback from contracts.approvals where contract_id = ${id}::uuid`;
    expect(ap).toMatchObject({ status: "level1", mode: "engine", feedback: "FLOW_STARTING" });
    const [ev] =
      await o`select actor_id::text as actor from hub.flow_events where event = 'contract.received' and ref = ${id}`;
    expect(ev?.actor).toBe(UB[0] as string);
  });
});

describe("CR-124 q6 · S2 · người gây sự kiện của flow nhận (một câu)", () => {
  const st = (owner: string | null) => receiveStateOf(db, B, owner);
  it("người phụ trách hợp lệ ⇒ dùng người đó; bị khoá / không hoạt động / khác công ty ⇒ lùi về quản trị", async () => {
    expect((await st(UB[1] as string)).actor).toBe(UB[1] as string);
    expect((await st(UB[2] as string)).actor).toBe(UB[0] as string); // locked_by_tenant
    expect((await st(UA)).actor).toBe(UB[0] as string); // người của công ty khác
    await o`update admin.users set active = false where id = ${UB[1] as string}`;
    expect((await st(UB[1] as string)).actor).toBe(UB[0] as string); // không hoạt động
    expect((await st(null)).actor).toBe(UB[0] as string);
  });
  it("không có quản trị hoạt động ⇒ null (KHÔNG lùi về thành viên bất kỳ)", async () => {
    await o`update admin.users set role = 'member' where id = ${UB[0] as string}`;
    expect((await st(null)).actor).toBeNull();
    expect((await st(UB[2] as string)).actor).toBeNull();
  });
});

describe("CR-124 q6 · chưa có người gây sự kiện + Mở lại", () => {
  it("sẵn sàng nhưng không có người phụ trách/quản trị ⇒ lượt kẹt RECEIVE_NO_OWNER, KHÔNG phát sự kiện", async () => {
    await o`update contracts.partner_settings set owner_user_id = null where tenant_id = ${B}`;
    await send(C[2] as string);
    expect(await receive()).toBe(1);
    const id = await inboxOf();
    const [ap] =
      await o`select status, feedback from contracts.approvals where contract_id = ${id}::uuid`;
    expect(ap).toMatchObject({ status: "level1", feedback: "RECEIVE_NO_OWNER" });
    expect(await o`select 1 from hub.flow_events where ref = ${id}`).toHaveLength(0);
  });

  it("Mở lại HĐ nhận ⇒ phát contract.received (người bấm là người gây), KHÔNG phát contract.submitted", async () => {
    const id = await inboxOf();
    await o`update admin.users set role = 'tenant_admin' where id = ${UB[0] as string}`;
    const resend = withFlowResend(undefined, {
      uow: uow() as never,
      flow: { prepare: async () => ({ on: true, departments: null }) } as never,
    });
    expect(await resend({ tenantId: B, userId: UB[0] as string }, id)).toBe("ok");
    const evs =
      await o`select event, actor_id::text as actor from hub.flow_events where ref = ${id}`;
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ event: "contract.received", actor: UB[0] as string });
  });
});
