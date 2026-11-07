// CR-124 · q3 · FLOW4-FR-01/02/07/08/11/15/17 · NFR-01/02 · gói Hợp đồng ⇄ hộp thư liên công ty, DB thật (pool hub_api, role contracts_rw, RLS gói):
// (1) tool gửi: kênh nền tảng khi đã nối, idempotent (lần gửi mở), kênh email/thủ công dự phòng; (2) bộ chuyển qua cổng gói: HĐ nhận
// `source='partner_inbox'` + `contract.received` cùng tx, mức = max(gợi ý, luật bên nhận), chạy lại không đôi; (3) OutcomeHandler Trả lại ⇒ lần
// gửi đóng + tín hiệu `partner.returned` về node chờ một lần; (4) gửi lại sau Trả lại: vòng 2, `prev_id`, không lời mời nối mới;
// (5) chặn đọc chéo tenant cho `partner_sends` + `partner_inbox` + `hub.partner_inbox_take`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { contracts, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, inPack, openOwner, pgCode, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { createPackUow } from "../kit/adapters/pack-uow";
import type { PackToolCtx } from "../kit/public";
import { withSystemScope } from "../kit/testing/system-scope";
import { approvalRepo } from "./adapters/approval.repo";
import { contractsRepo } from "./adapters/contracts.repo";
import { esignRepo } from "./adapters/esign.repo";
import { partnerSendRepo } from "./adapters/partner-send.repo";
import { partnerSendTool } from "./adapters/partner-send.tool";
import { engineView } from "./application/approval-engine-card.usecase";
import { listContracts } from "./application/list-contracts.usecase";
import { stepLabelOf } from "./domain/approval-step-label.rules";
import { contractsOutcomeHandler } from "./flow-events.mount";
import { onPartnerReplies, receiveInbox } from "./partner-mailbox.mount";

let o: Sql;
let db: Db;
let A = "";
let B = "";
let UA = "";
let UB = "";
let C: string[] = [];
const signals: { tenantId: string; ref: string; event: string }[] = [];
const TAX_B = "0101234567";

const uow = () =>
  createPackUow(db, "contracts", (tx, t) => ({
    partnerSend: partnerSendRepo(tx, t),
    esign: esignRepo(tx, t),
  }));
const ctx = (): PackToolCtx => ({ tenantId: A, userId: UA, runId: null, processRunId: null });
const send = (id: string, extra: Record<string, unknown> = {}) =>
  partnerSendTool({ uow: uow() }).run(ctx(), {
    contract_id: id,
    send_fields: "total_value",
    ...extra,
  });
const port = () => ({
  receive: receiveInbox(db),
  onReplies: onPartnerReplies(
    db,
    () =>
      ({
        port: {
          signalEvent: async (tenantId: string, r: { record_id: string }, event: string) => {
            signals.push({ tenantId, ref: r.record_id, event });
            return 1;
          },
        },
      }) as never,
  ),
});
/** Bộ chuyển (hub `partners/`, test riêng ở partners/mailbox-port.int.test.ts) gọi cổng gói theo đúng hai bước này. */
const receive = () => port().receive(B, 100);
const replies = async () => {
  const rows = await o<
    {
      mailboxId: string;
      tenantId: string;
      ref: string | null;
      outcome: "confirmed" | "returned" | "declined";
      reason: string | null;
      source: string;
      round: number;
    }[]
  >`
    select id::text as "mailboxId", from_tenant::text as "tenantId", from_ref as ref, outcome, reason, replied_by_source as source, round
    from hub.partner_mailbox where status = 'replied' and reply_emitted_at is null`;
  await port().onReplies(rows);
  await o`update hub.partner_mailbox set reply_emitted_at = now() where id = any(${rows.map((r) => r.mailboxId)}::uuid[])`;
  return rows.length;
};

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [A, B] = (await tenants(o, 2, 1324)) as [string, string];
  [UA] = (await users(o, A, 1, { from: 1324 })) as [string];
  [UB] = (await users(o, B, 1, { from: 1325 })) as [string];
  await o`update admin.tenants set legal_name = 'Công ty A', tax_code = '0109999999' where id = ${A}`;
  await o`update admin.tenants set legal_name = 'Công ty B', tax_code = ${TAX_B}, directory_listed = true where id = ${B}`;
  C = await contracts(o, A, 3, { from: 1324, createdBy: UA, status: "active" });
  for (const [i, id] of C.entries()) {
    const fid = crypto.randomUUID();
    await o`insert into contracts.files (id, tenant_id, org, file_id, version_id, name, mime, size_bytes, created_by)
      values (${fid}, ${A}, ${`t_${A}`}, ${`f${i}`}, ${`v${i}`}, 'hd.pdf', 'application/pdf', 16, ${UA})`;
    const tax = i === 0 ? TAX_B : i === 1 ? "0100000001" : null;
    await o`update contracts.contracts set file_id = ${fid}, direction = 'sale', fields = ${o.json({
      buyer_name: { value: "Đối tác" },
      ...(tax ? { buyer_tax_id: { value: tax } } : {}),
      total_value: { value: 600_000_000 },
      secret_note: { value: "không được lộ" },
    } as never)} where id = ${id}`;
  }
  await o`insert into hub.partner_links (from_tenant, to_tenant, requested_at, accepted_at) values (${A}, ${B}, now(), now())`;
  // B: flow nhận SẴN SÀNG (cờ flow bật + flow «Nhận HĐ thường» của Thư viện gán) + người gây sự kiện = quản trị B ⇒ HĐ nhận có lượt duyệt.
  await o`update admin.users set role = 'tenant_admin' where id = ${UB}`;
  await o`insert into hub.tenant_flow_settings (tenant_id, flow_triggers) values (${B}, true)`;
  await o`insert into hub.company_flows (tenant_id, flow_id, enabled) values (${B}, '0c124000-0000-4000-8000-0000000000c2', true)`;
  db = createDb(urls().hubApi, { max: 4 });
}, 60_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-124 q3 · gửi → nhận → trả lời", () => {
  it("FR-15/01: đã nối ⇒ kênh nền tảng; gửi lại cùng lúc ⇒ không gửi đôi (idempotent)", async () => {
    const r = await send(C[0] as string);
    expect(r).toMatchObject({ status: "sent", channel: "platform", round: 1 });
    const again = await send(C[0] as string);
    expect(again).toMatchObject({ status: "already_sent", mailbox_id: r.mailbox_id });
    const n = await o`select count(*)::int as n from hub.partner_mailbox where from_tenant = ${A}`;
    expect(n[0]?.n).toBe(1);
    const [m] =
      await o`select payload from hub.partner_mailbox where id = ${r.mailbox_id as string}::uuid`;
    expect(JSON.stringify(m?.payload)).not.toContain("không được lộ"); // chỉ trường A chọn
  });

  it("FR-07/08: bộ chuyển tạo HĐ nhận riêng của B + contract.received; mức = max(gợi ý thường, luật 600 triệu) = quan trọng; chạy lại không đôi", async () => {
    expect(await receive()).toBe(1);
    expect(await receive()).toBe(0);
    const rows = await o<{ id: string; importance: string; sender_name: string; round: number }[]>`
      select contract_id::text as id, importance, sender_name, round from contracts.partner_inbox where tenant_id = ${B}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ importance: "important", sender_name: "Công ty A", round: 1 });
    const [c] =
      await o`select source, status, tenant_id::text as t from contracts.contracts where id = ${rows[0]?.id as string}::uuid`;
    expect(c).toMatchObject({ source: "partner_inbox", status: "needs_review", t: B });
    // Thẻ duyệt: HĐ nhận có lượt duyệt chờ quy trình nhận (người duyệt của B quyết trên trang HĐ như HĐ gửi duyệt).
    const [ap] =
      await o`select a.status, a.mode, a.feedback, a.engine_run_id from contracts.approvals a
      join contracts.contracts k on k.run_id = a.id and k.tenant_id = a.tenant_id where k.id = ${rows[0]?.id as string}::uuid`;
    expect(ap).toMatchObject({ status: "level1", mode: "engine", engine_run_id: null });
    const ev =
      await o`select ref, tenant_id::text as t, actor_id::text as actor from hub.flow_events where event = 'contract.received'`;
    expect(ev).toHaveLength(1);
    // Có người gây sự kiện (chưa đặt người phụ trách ⇒ quản trị/thành viên sớm nhất của B) — thiếu ⇒ bộ điều phối từ chối, HĐ nhận kẹt.
    expect(ev[0]).toMatchObject({ ref: rows[0]?.id, t: B, actor: UB });
    const [mb] = await o`select status from hub.partner_mailbox where from_tenant = ${A}`;
    expect(mb?.status).toBe("delivered");
    // A không có dòng nào của B và ngược lại (HĐ nhận chỉ ở B).
    const aSide =
      await o`select 1 from contracts.contracts where tenant_id = ${A} and source = 'partner_inbox'`;
    expect(aSide).toHaveLength(0);
  });

  it("FR-11/02: Kết thúc flow nhận = Trả lại ⇒ lần gửi đóng + tín hiệu partner.returned đúng một lần", async () => {
    const [inb] = await o<
      { id: string }[]
    >`select contract_id::text as id from contracts.partner_inbox where tenant_id = ${B}`;
    const input = {
      tenantId: B,
      runId: crypto.randomUUID(),
      event: "contract.received",
      ref: inb?.id as string,
      outcome: "returned",
      actorId: null,
    };
    const apply = () =>
      withSystemScope(db, { kind: "system" }, (tx) => contractsOutcomeHandler().apply(tx, input));
    // Bộ điều phối mở lượt flow nhận ⇒ `launched` gắn run vào thẻ duyệt của HĐ nhận (như contract.submitted).
    const launched = await withSystemScope(
      db,
      { kind: "system" },
      (tx) =>
        contractsOutcomeHandler().launched?.(tx, {
          tenantId: B,
          runId: input.runId,
          event: input.event,
          ref: input.ref,
        }) ?? Promise.resolve(false),
    );
    expect(launched).toBe(true);
    const [att] = await o`select a.engine_run_id::text as r, a.feedback from contracts.approvals a
      join contracts.contracts k on k.run_id = a.id where k.id = ${input.ref}::uuid`;
    expect(att).toMatchObject({ r: input.runId, feedback: null });
    // Người thấy (giám đốc B): bước duyệt ĐẦU của flow nhận là bước duyệt thật ⇒ thẻ `from_run` + quyết được, cột "Bước" = "Chờ <bước> duyệt".
    const whoB = { tenantId: B, userId: UB, platform: true };
    const bUow = createPackUow(db, "contracts", (tx, t) => ({
      approval: approvalRepo(tx, t),
      contracts: contractsRepo(tx, t),
    }));
    const appr = await bUow.tenant(whoB, (r) => r.approval.state(input.ref, { lock: false }));
    const sv = {
      run_id: input.runId,
      status: "waiting_review",
      started_by: UB,
      steps: [
        {
          idx: 0,
          key: "duyet-nhan",
          name: "Giám đốc duyệt",
          status: "open",
          group_id: null,
          escalated_group_id: null,
          due_at: null,
          escalated: false,
          result: null,
          decided_by: null,
          decided_at: null,
          feedback: null,
          task: { id: "task-1", can_act: true },
        },
      ],
    };
    const card = await engineView({
      port: () => ({ stepsView: async () => sv }) as never,
      uow: bUow as never,
      jobs: { enqueue: async () => {} },
    })(whoB, appr as never);
    expect(card).toMatchObject({
      mode: "engine",
      from_run: true,
      can_act: true,
      task_id: "task-1",
    });
    const labels: string[] = [];
    const page = await listContracts<{ id: string; step_label?: string | null }>({
      uow: bUow as never,
      stepLabels: async (_w, ids, fromRuns) => {
        expect(fromRuns.has(input.runId)).toBe(true);
        labels.push(...ids);
        return new Map([[input.runId, stepLabelOf(sv as never, fromRuns.has(input.runId))]]);
      },
    })(whoB, { sort: "updated_at", dir: "desc", page: 1, page_size: 20 } as never);
    expect(labels).toEqual([input.runId]);
    expect(page.items.find((x) => x.id === input.ref)?.step_label).toBe("Chờ Giám đốc duyệt");
    expect(await apply()).toBe("applied");
    const [done] =
      await o`select a.status from contracts.approvals a join contracts.contracts k on k.run_id = a.id
      where k.id = ${input.ref}::uuid`;
    expect(done?.status).toBe("cancelled"); // Trả lại ⇒ lượt duyệt của HĐ nhận đóng
    expect(await apply()).toBe("already_applied");
    const st = await o`select status, reason from contracts.partner_inbox where tenant_id = ${B}`;
    expect(st[0]?.status).toBe("returned");
    expect(await replies()).toBe(1);
    expect(await replies()).toBe(0);
    expect(signals).toEqual([{ tenantId: A, ref: C[0] as string, event: "partner.returned" }]);
    const [ps] =
      await o`select status, reason from contracts.partner_sends where tenant_id = ${A} and contract_id = ${C[0] as string}`;
    expect(ps?.status).toBe("returned");
    expect(ps?.reason).toBeTruthy();
  });

  it("FR-17: gửi lại sau Trả lại ⇒ vòng 2, prev_id, B thấy lý do lần trước, không thêm lời mời nối", async () => {
    const r = await send(C[0] as string);
    expect(r).toMatchObject({ status: "sent", channel: "platform", round: 2 });
    expect(await receive()).toBe(1);
    const [inb] =
      await o`select round, prev_reason from contracts.partner_inbox where tenant_id = ${B} and round = 2`;
    expect(inb?.round).toBe(2);
    expect(inb?.prev_reason).toBeTruthy();
    const [mb] =
      await o`select prev_id from hub.partner_mailbox where id = ${r.mailbox_id as string}::uuid`;
    expect(mb?.prev_id).toBeTruthy();
    expect((await o`select 1 from hub.partner_links`).length).toBe(1);
  });

  it("FR-15: công ty chưa trên nền tảng + có email ⇒ email; không email ⇒ thủ công; MST của B tắt danh bạ ⇒ không lộ", async () => {
    expect(await send(C[1] as string, { partner_email: "lh@doitac.vn" })).toMatchObject({
      channel: "email",
      why: "not_on_platform",
    });
    expect(await send(C[2] as string)).toMatchObject({ channel: "manual" });
    await o`update admin.tenants set directory_listed = false where id = ${B}`;
    const r = await inPack("contracts", A, (tx) => tx`select * from hub.partner_route(${TAX_B})`);
    expect(r).toHaveLength(0);
    await o`update admin.tenants set directory_listed = true where id = ${B}`;
  });
});

describe("CR-124 q3 · NFR-01 chặn đọc chéo tenant (bảng mới)", () => {
  it("hub.partner_inbox_take: thư 'sent' gửi tới B — A lấy 0 dòng và thư giữ nguyên; B lấy đúng 1", async () => {
    const [m] = await inPack(
      "contracts",
      A,
      (tx) => tx`select hub.partner_send(${A}::uuid, ${B}::uuid, null, 'platform', 'ref-take',
        '{"title":"T"}'::jsonb, null, null, now() + interval '3 days', null)::text as id`,
    );
    const id = m?.id as string;
    expect(
      await inPack("contracts", A, (tx) => tx`select * from hub.partner_inbox_take(100)`),
    ).toHaveLength(0);
    const [still] = await o`select status from hub.partner_mailbox where id = ${id}::uuid`;
    expect(still?.status).toBe("sent");
    const taken = await inPack(
      "contracts",
      B,
      (tx) => tx`select id::text from hub.partner_inbox_take(100)`,
    );
    expect(taken.map((r) => r.id)).toEqual([id]);
  });
  it("partner_sends: tenant B không thấy lần gửi của A", async () => {
    const mine = await inPack("contracts", A, (tx) => tx`select id from contracts.partner_sends`);
    expect(mine.length).toBeGreaterThan(0);
    expect(
      await inPack("contracts", B, (tx) => tx`select id from contracts.partner_sends`),
    ).toHaveLength(0);
  });
  it("partner_inbox: tenant A không thấy HĐ nhận của B; hub.partner_inbox_take chỉ lấy thư của chính tenant", async () => {
    expect(
      (await inPack("contracts", B, (tx) => tx`select id from contracts.partner_inbox`)).length,
    ).toBeGreaterThan(0);
    expect(
      await inPack("contracts", A, (tx) => tx`select id from contracts.partner_inbox`),
    ).toHaveLength(0);
    expect(
      await inPack("contracts", A, (tx) => tx`select * from hub.partner_inbox_take(100)`),
    ).toHaveLength(0);
    expect(
      await pgCode(() => inPack("contracts", A, (tx) => tx`select 1 from hub.partner_mailbox`)),
    ).toBe("42501");
  });
});
