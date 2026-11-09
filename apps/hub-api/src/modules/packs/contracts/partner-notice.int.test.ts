// CR-126 · «Vào app + email báo» · DB thật: bên nhận ĐÃ trên nền tảng ⇒ dòng hộp thư vẫn tới «Hộp thư đối tác» của B, thêm `to_email` = người nhận ĐÃ
// CHỌN và đúng MỘT thư báo (link vào app, không link trả lời không đăng nhập); gửi lại sau Trả lại = vòng 2 = thêm đúng một thư; kênh email giữ nguyên.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { contracts, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { FakeEmailTransport } from "../../notify/adapters/transport.fake";
import { partnerNoticeOnce } from "../../partners/notice-dispatch";
import { createPackUow } from "../kit/adapters/pack-uow";
import type { PackToolCtx, PartnerMailboxPort } from "../kit/public";
import { esignRepo } from "./adapters/esign.repo";
import { partnerSendRepo } from "./adapters/partner-send.repo";
import { partnerSendTool } from "./adapters/partner-send.tool";
import { buildPartnerNoticeMail } from "./domain/partner-notice-mail.rules";

let o: Sql;
let db: Db;
let A = "";
let B = "";
let UA = "";
let C: string[] = [];
const TAX_B = "0108888881"; // công ty B trên nền tảng (đã nối)
const TAX_X = "0108888882"; // đối tác chưa trên nền tảng
const CHOSEN = "nguoi-chon@congty-b.vn";

const mail = new FakeEmailTransport();
const port: PartnerMailboxPort = {
  receive: async () => 0,
  onReplies: async () => undefined,
  notice: buildPartnerNoticeMail,
};
const dispatch = () =>
  partnerNoticeOnce({ db, email: () => mail, baseUrl: "https://app.test.vn", port: () => port });
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
    await o`select to_email, to_tenant::text as to_tenant, channel, status, round from hub.partner_mailbox where id = ${id}::uuid`
  )[0];

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

describe("CR-126 · thư báo kênh nền tảng", () => {
  it("nền tảng ⇒ dòng tới B có to_email = người nhận đã chọn, đúng MỘT thư báo link vào app, chạy lại không gửi đôi", async () => {
    const r = await send(C[0] as string, { partner_email: CHOSEN, partner_tax_code: TAX_B });
    expect(r).toMatchObject({ status: "sent", channel: "platform", round: 1 });
    expect(await mailboxOf(r.mailbox_id as string)).toMatchObject({
      to_email: CHOSEN,
      to_tenant: B,
      channel: "platform",
      status: "sent",
    });
    expect(await dispatch()).toMatchObject({ claimed: 1, sent: 1 });
    expect(await dispatch()).toMatchObject({ claimed: 0 });
    expect(mail.sent).toHaveLength(1);
    const m = mail.sent[0] as { to: string; subject: string; text: string; html: string };
    expect(m.to).toBe(CHOSEN);
    expect(m.subject).toMatch(/^Công ty A gửi hợp đồng .+ cần anh\/chị xác nhận$/);
    expect(m.text).toContain("https://app.test.vn/contracts/partner-inbox");
    expect(m.text).not.toContain("/partner-reply/");
    // engine thử lại ⇒ đã có lần gửi mở ⇒ không dòng mới ⇒ không thư mới
    expect(await send(C[0] as string, { partner_email: CHOSEN })).toMatchObject({
      status: "already_sent",
    });
    expect(await dispatch()).toMatchObject({ claimed: 0 });
  });

  it("trả lại rồi gửi lại cùng người nhận ⇒ vòng 2 ⇒ thêm đúng một thư", async () => {
    const id = C[0] as string;
    await o`update contracts.partner_sends set status = 'returned' where contract_id = ${id}`;
    const r = await send(id, { partner_email: CHOSEN, partner_tax_code: TAX_B });
    expect(r).toMatchObject({ status: "sent", channel: "platform", round: 2 });
    expect(await dispatch()).toMatchObject({ claimed: 1, sent: 1 });
    expect(mail.sent).toHaveLength(2);
    expect((mail.sent[1] as { text: string }).text).toContain("bản sửa lần 2");
  });

  it("kênh email (bên nhận chưa trên nền tảng) giữ nguyên: to_email = người chọn, KHÔNG thư báo kênh nền tảng", async () => {
    const r = await send(C[1] as string, {
      partner_email: "khac@doitac.vn",
      partner_tax_code: TAX_X,
    });
    expect(r).toMatchObject({ channel: "email" });
    expect((await mailboxOf(r.mailbox_id as string))?.to_email).toBe("khac@doitac.vn");
    expect(await dispatch()).toMatchObject({ claimed: 0 });
    expect(mail.sent).toHaveLength(2);
  });
});
