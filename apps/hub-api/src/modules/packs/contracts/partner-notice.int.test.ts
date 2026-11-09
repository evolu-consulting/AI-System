// CR-126 · «Vào app + email báo» · phía GỬI (tool gói) · DB thật: bên nhận ĐÃ trên nền tảng ⇒ dòng hộp thư vẫn tới B (`to_tenant`) và mang `to_email` =
// người nhận ĐÃ CHỌN + tên công ty gửi cho thư báo; gửi lại sau Trả lại = vòng 2 (cùng người nhận) vẫn khớp kiểm `prev_id` của DB; kênh email giữ nguyên.
// Bộ gửi thư báo (hub `partners/`) test riêng ở `partners/notice.int.test.ts`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { contracts, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { createPackUow } from "../kit/adapters/pack-uow";
import type { PackToolCtx } from "../kit/public";
import { esignRepo } from "./adapters/esign.repo";
import { partnerSendRepo } from "./adapters/partner-send.repo";
import { partnerSendTool } from "./adapters/partner-send.tool";

let o: Sql;
let db: Db;
let A = "";
let B = "";
let UA = "";
let C: string[] = [];
const TAX_B = "0108888881"; // công ty B trên nền tảng (đã nối)
const TAX_X = "0108888882"; // đối tác chưa trên nền tảng
const CHOSEN = "nguoi-chon@congty-b.vn";

const uow = () =>
  createPackUow(db, "contracts", (tx, t) => ({
    partnerSend: partnerSendRepo(tx, t),
    esign: esignRepo(tx, t),
  }));
const ctx = (): PackToolCtx => ({ tenantId: A, userId: UA, runId: null, processRunId: null });
const send = (id: string, extra: Record<string, unknown>) =>
  partnerSendTool({ uow: uow() }).run(ctx(), { contract_id: id, ...extra });
const mailboxOf = async (id: string) =>
  (
    await o`select to_email, to_tenant::text as to_tenant, channel, status, round, payload from hub.partner_mailbox where id = ${id}::uuid`
  )[0];

const senderOf = (m: { payload?: unknown } | undefined): string | undefined =>
  ((m?.payload ?? {}) as { sender_name?: string }).sender_name;

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [A, B] = (await tenants(o, 2, 1380)) as [string, string];
  [UA] = (await users(o, A, 1, { from: 1380 })) as [string];
  await o`update admin.tenants set legal_name = 'Công ty A', tax_code = '0109999998' where id = ${A}`;
  await o`update admin.tenants set legal_name = 'Công ty B', tax_code = ${TAX_B}, directory_listed = true where id = ${B}`;
  C = (await contracts(o, A, 2, { from: 1380, createdBy: UA, status: "active" })) as string[];
  for (const [i, id] of C.entries()) {
    const tax = i === 0 ? TAX_B : TAX_X;
    const fid = crypto.randomUUID();
    await o`insert into contracts.files (id, tenant_id, org, file_id, version_id, name, mime, size_bytes, created_by)
      values (${fid}, ${A}, ${`t_${A}`}, ${`f${i}`}, ${`v${i}`}, 'hd.pdf', 'application/pdf', 16, ${UA})`;
    await o`update contracts.contracts set file_id = ${fid}, direction = 'sale', fields = ${o.json({
      buyer_name: { value: `Đối tác ${tax}` },
      buyer_tax_id: { value: tax },
    } as never)} where id = ${id}`;
    await o`insert into contracts.partner_contacts (tenant_id, party_key, name, email, created_by)
      values (${A}, ${`tax:${tax}`}, 'Liên hệ', ${`mac-dinh@${tax}.vn`}, ${UA})`;
  }
  await o`insert into hub.partner_links (from_tenant, to_tenant, requested_at, accepted_at) values (${A}, ${B}, now(), now())`;
  db = createDb(urls().hubApi, { max: 4 });
}, 60_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-126 · gửi kênh nền tảng mang email người nhận", () => {
  it("nền tảng ⇒ dòng tới B có to_email = người nhận đã chọn và tên công ty gửi, gửi lại không thêm dòng", async () => {
    const r = await send(C[0] as string, { partner_email: CHOSEN, partner_tax_code: TAX_B });
    expect(r).toMatchObject({ status: "sent", channel: "platform", round: 1 });
    const m = await mailboxOf(r.mailbox_id as string);
    expect(m).toMatchObject({
      to_email: CHOSEN,
      to_tenant: B,
      channel: "platform",
      status: "sent",
    });
    expect(senderOf(m)).toBe("Công ty A");
    expect(await send(C[0] as string, { partner_email: CHOSEN })).toMatchObject({
      status: "already_sent",
      mailbox_id: r.mailbox_id,
    });
    const n = await o`select count(*)::int as n from hub.partner_mailbox where from_tenant = ${A}`;
    expect(n[0]?.n).toBe(1);
  });

  it("trả lại rồi gửi lại cùng người nhận ⇒ vòng 2 nối với lần trước và mang to_email", async () => {
    const id = C[0] as string;
    await o`update contracts.partner_sends set status = 'returned' where contract_id = ${id}`;
    const r = await send(id, { partner_email: CHOSEN, partner_tax_code: TAX_B });
    expect(r).toMatchObject({ status: "sent", channel: "platform", round: 2 });
    const m = await mailboxOf(r.mailbox_id as string);
    expect(m).toMatchObject({ to_email: CHOSEN, round: 2 });
  });

  it("kênh email (bên nhận chưa trên nền tảng) giữ nguyên: to_email = người chọn, không có tên công ty gửi thêm", async () => {
    const r = await send(C[1] as string, {
      partner_email: "khac@doitac.vn",
      partner_tax_code: TAX_X,
    });
    expect(r).toMatchObject({ channel: "email" });
    const m = await mailboxOf(r.mailbox_id as string);
    expect(m?.to_email).toBe("khac@doitac.vn");
    expect(senderOf(m)).toBeUndefined();
  });
});
