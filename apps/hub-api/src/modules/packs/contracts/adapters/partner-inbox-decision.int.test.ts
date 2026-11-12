// CR-127 · K8 · BR-57/58/59 · spec §3 #9–11, #9b — hai công ty thật (A gửi, B nhận), DB thật (role contracts_rw, RLS gói):
// (1) B KHÔNG có quy trình nhận ⇒ HĐ nhận PROCESSING + chờ người phụ trách quyết + dòng "Việc của tôi" CHỈ cho người phụ trách;
// (2) Trả lại (ý kiến + bằng chứng) ⇒ DRAFT, đối tác nhận Trả lại; A gửi bản sửa ⇒ CÙNG HĐ nhận, chạy lại từ đầu (PROCESSING, vòng 2);
// (3) Đồng ý ⇒ DONE + báo bên gửi (lần gửi 'replied' confirmed); quyết lại ⇒ INBOX_NOT_AWAITING; người khác ⇒ không quyết được;
// (4) hook notLaunched `contract.received` ⇒ chờ quyết; (5) danh sách lọc nguồn; (6) chặn chéo tenant.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db, type Tx } from "@ai/db";
import { contracts, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { createPackUow } from "../../kit/adapters/pack-uow";
import type { PackToolCtx } from "../../kit/public";
import { withSystemScope } from "../../kit/testing/system-scope";
import { listContracts } from "../application/list-contracts.usecase";
import { myWorkWindow } from "../application/mywork.usecase";
import { contractsOutcomeHandler } from "../flow-events.mount";
import { receiveInbox } from "../partner-mailbox.mount";
import { contractsRepo } from "./contracts.repo";
import { esignRepo } from "./esign.repo";
import { myWorkRepo } from "./mywork.repo";
import { decideInbox, type InboxDecision } from "./partner-inbox-decision.repo";
import { partnerSendRepo } from "./partner-send.repo";
import { partnerSendTool } from "./partner-send.tool";

let o: Sql;
let db: Db;
let A = "";
let B = "";
let UA = "";
let UB = ""; // quản trị B
let OWN = ""; // người phụ trách HĐ nhận của B
let MEM = ""; // thành viên B khác
let C: string[] = [];
const TAX_B = "0101234568";

const uow = () =>
  createPackUow(db, "contracts", (tx: Tx, t: string) => ({
    partnerSend: partnerSendRepo(tx, t),
    esign: esignRepo(tx, t),
    contracts: contractsRepo(tx, t),
    mywork: myWorkRepo(tx, t),
    tx,
    tid: t,
  }));
const ctx = (): PackToolCtx => ({ tenantId: A, userId: UA, runId: null, processRunId: null });
const send = (id: string) =>
  partnerSendTool({ uow: uow() }).run(ctx(), { contract_id: id, send_fields: "total_value" });
const receive = () => receiveInbox(db)(B, 100);
const decide = (
  who: { tenantId: string; userId: string },
  id: string,
  decision: InboxDecision,
  note: string | null = null,
  isAdmin = false,
) =>
  uow().tenant(who, (x) =>
    decideInbox(x.tx, x.tid, {
      contractId: id,
      decision,
      actorId: who.userId,
      isAdmin,
      evidence: note ? { note } : null,
    }),
  );
const inboxOf = async (cid: string) => [
  ...(await o<{ round: number; status: string; awaiting: boolean }[]>`
    select round, status, awaiting_decision as awaiting from contracts.partner_inbox
    where tenant_id = ${B} and contract_id = ${cid}::uuid order by round`),
];
const statusOf = async (cid: string) =>
  (await o`select status, submit_round from contracts.contracts where id = ${cid}::uuid`)[0];
const myInbox = async (userId: string) =>
  (
    await uow().tenant({ tenantId: B, userId }, (x) =>
      x.mywork.list(myWorkWindow(new Date(), "Asia/Ho_Chi_Minh")),
    )
  ).inbox ?? [];

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [A, B] = (await tenants(o, 2, 1427)) as [string, string];
  [UA] = (await users(o, A, 1, { from: 1427 })) as [string];
  [UB, OWN, MEM] = (await users(o, B, 3, { from: 1428 })) as [string, string, string];
  await o`update admin.tenants set legal_name = 'Công ty A', tax_code = '0109999998' where id = ${A}`;
  await o`update admin.tenants set legal_name = 'Công ty B', tax_code = ${TAX_B}, directory_listed = true where id = ${B}`;
  await o`update admin.users set role = 'tenant_admin' where id = ${UB}`;
  // B CHƯA có quy trình nhận (không company_flows cho contract.received) + người phụ trách HĐ nhận = OWN.
  await o`insert into contracts.partner_settings (tenant_id, owner_user_id) values (${B}, ${OWN})`;
  C = await contracts(o, A, 2, { from: 1427, createdBy: UA, status: "active" });
  for (const [i, id] of C.entries()) {
    const fid = crypto.randomUUID();
    await o`insert into contracts.files (id, tenant_id, org, file_id, version_id, name, mime, size_bytes, created_by)
      values (${fid}, ${A}, ${`t_${A}`}, ${`g${i}`}, ${`w${i}`}, 'hd.pdf', 'application/pdf', 16, ${UA})`;
    await o`update contracts.contracts set file_id = ${fid}, direction = 'sale', fields = ${o.json({
      buyer_name: { value: "Công ty B" },
      buyer_tax_id: { value: TAX_B },
      total_value: { value: 100_000_000 + i },
    } as never)} where id = ${id}`;
  }
  await o`insert into hub.partner_links (from_tenant, to_tenant, requested_at, accepted_at) values (${A}, ${B}, now(), now())`;
  db = createDb(urls().hubApi, { max: 4 });
}, 60_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

let R1 = "";

describe("CR-127 K8 · nhận không có quy trình ⇒ người phụ trách quyết", () => {
  it("#9b: HĐ nhận PROCESSING + chờ quyết; việc chỉ của người phụ trách; không lượt duyệt treo", async () => {
    expect((await send(C[0] as string)).status).toBe("sent");
    expect(await receive()).toBe(1);
    const [r] = await o<{ id: string; owner: string }[]>`
      select c.id::text, c.owner_user_id::text as owner from contracts.contracts c
      where c.tenant_id = ${B} and c.source = 'partner_inbox'`;
    R1 = r?.id as string;
    expect(r?.owner).toBe(OWN);
    expect(await statusOf(R1)).toMatchObject({ status: "processing" });
    expect(await inboxOf(R1)).toEqual([{ round: 1, status: "pending", awaiting: true }]);
    expect(
      await o`select 1 from contracts.approvals where tenant_id = ${B} and contract_id = ${R1}::uuid`,
    ).toHaveLength(0);
    expect((await myInbox(OWN)).map((x) => [x.contract_id, x.sender_name, x.round])).toEqual([
      [R1, "Công ty A", 1],
    ]);
    expect(await myInbox(MEM)).toEqual([]);
  });

  it("Trả lại cần ý kiến ở route; người khác không quyết được; Trả lại ⇒ DRAFT + đối tác nhận Trả lại kèm ý kiến", async () => {
    const other = await decide({ tenantId: B, userId: MEM }, R1, "accept");
    expect("error" in other).toBe(true);
    expect(await statusOf(R1)).toMatchObject({ status: "processing" });
    const out = await decide(
      { tenantId: B, userId: OWN },
      R1,
      "return",
      "Sửa điều khoản thanh toán",
    );
    expect(out).toEqual({ status: "draft" });
    expect(await inboxOf(R1)).toEqual([{ round: 1, status: "returned", awaiting: false }]);
    const [mb] =
      await o`select status, outcome, reason from hub.partner_mailbox where from_tenant = ${A}`;
    expect(mb).toMatchObject({
      status: "replied",
      outcome: "returned",
      reason: "Sửa điều khoản thanh toán",
    });
    const ev =
      await o`select 1 from hub.evidence where tenant_id = ${B} and subject_id = ${R1}::uuid`;
    expect(ev).toHaveLength(1);
    expect(await myInbox(OWN)).toEqual([]);
  });

  it("Q10/#11: bản sửa của A vào CÙNG HĐ nhận, chạy lại từ đầu (PROCESSING, vòng 2, chờ quyết lại)", async () => {
    await o`update hub.partner_mailbox set reply_emitted_at = now() where from_tenant = ${A}`;
    await o`update contracts.partner_sends set status = 'returned' where tenant_id = ${A} and contract_id = ${C[0] as string}`;
    const r2 = await send(C[0] as string);
    expect(r2).toMatchObject({ status: "sent", round: 2 });
    expect(await receive()).toBe(1);
    expect(
      await o`select 1 from contracts.contracts where tenant_id = ${B} and source = 'partner_inbox'`,
    ).toHaveLength(1);
    expect(await statusOf(R1)).toMatchObject({ status: "processing", submit_round: 1 });
    expect(await inboxOf(R1)).toEqual([
      { round: 1, status: "returned", awaiting: false },
      { round: 2, status: "pending", awaiting: true },
    ]);
    const ev =
      await o`select ref from hub.flow_events where event = 'contract.received' and tenant_id = ${B}`;
    expect(ev.map((e) => e.ref)).toEqual([R1, R1]);
  });

  it("Đồng ý ⇒ DONE + báo bên gửi; quyết lại ⇒ INBOX_NOT_AWAITING", async () => {
    expect(await decide({ tenantId: B, userId: OWN }, R1, "accept")).toEqual({ status: "done" });
    expect((await inboxOf(R1))[1]).toEqual({ round: 2, status: "confirmed", awaiting: false });
    const [mb] =
      await o`select status, outcome from hub.partner_mailbox where from_tenant = ${A} and round = 2`;
    expect(mb).toMatchObject({ status: "replied", outcome: "confirmed" });
    expect(await decide({ tenantId: B, userId: OWN }, R1, "accept")).toEqual({
      error: "INBOX_NOT_AWAITING",
    });
  });

  it("chặn chéo tenant: A quyết HĐ nhận của B ⇒ not_found, không đổi gì", async () => {
    expect(await decide({ tenantId: A, userId: UA }, R1, "reject", "x", true)).toEqual({
      error: "not_found",
    });
    expect(await statusOf(R1)).toMatchObject({ status: "done" });
  });
});

describe("CR-127 K8 · hook + danh sách nguồn", () => {
  it("notLaunched contract.received (có lượt duyệt chờ) ⇒ đóng lượt + chờ người phụ trách quyết; quản trị quyết được", async () => {
    expect((await send(C[1] as string)).status).toBe("sent");
    expect(await receive()).toBe(1);
    const [r] = await o<{ id: string }[]>`select id::text from contracts.contracts
      where tenant_id = ${B} and source = 'partner_inbox' and id <> ${R1}::uuid`;
    const id = r?.id as string;
    // Giả lập flow nhận đã sẵn sàng lúc nhận (lượt duyệt chờ bộ điều phối) rồi bộ điều phối không mở được lượt.
    const aid = crypto.randomUUID();
    await o`insert into contracts.approvals (id, tenant_id, contract_id, status, started_by, mode, feedback)
      values (${aid}, ${B}, ${id}, 'level1', '00000000-0000-0000-0000-000000000000', 'engine', 'FLOW_STARTING')`;
    await o`update contracts.contracts set run_id = ${aid} where id = ${id}::uuid`;
    await o`update contracts.partner_inbox set awaiting_decision = false where contract_id = ${id}::uuid`;
    const hit = await withSystemScope(
      db,
      { kind: "system" },
      (tx) =>
        contractsOutcomeHandler().notLaunched?.(tx, {
          tenantId: B,
          event: "contract.received",
          ref: id,
          reason: "FLOW_NOT_ASSIGNED",
        }) ?? Promise.resolve(false),
    );
    expect(hit).toBe(true);
    expect(await inboxOf(id)).toEqual([{ round: 1, status: "pending", awaiting: true }]);
    const [ap] = await o`select status from contracts.approvals where id = ${aid}::uuid`;
    expect(ap?.status).toBe("failed");
    expect(await decide({ tenantId: B, userId: UB }, id, "reject", "Không hợp tác", true)).toEqual({
      status: "reject",
    });
  });

  it("BR-59: lọc nguồn đối tác gửi / mình tải; hàng có `source`", async () => {
    await contracts(o, B, 1, { from: 1499, createdBy: UB });
    const page = (source?: string[]) =>
      listContracts<{ id: string; source?: string }>({ uow: uow() as never })(
        { tenantId: B, userId: UB, platform: true },
        {
          sort: "updated_at",
          dir: "desc",
          page: 1,
          page_size: 50,
          ...(source ? { source } : {}),
        } as never,
      );
    const all = await page();
    expect(all.items.length).toBe(3);
    const partner = await page(["partner"]);
    expect(partner.items.length).toBe(2);
    expect(partner.items.every((x) => x.source === "partner")).toBe(true);
    const upload = await page(["upload"]);
    expect(upload.items.map((x) => x.source)).toEqual(["upload"]);
  });
});
