// CR-126 · «Vào app + email báo» · bộ gửi thư BÁO (hub `partners/`) · DB thật + transport giả: dòng kênh nền tảng có `to_email` ⇒ đúng MỘT thư báo (link vào
// app, không link trả lời không đăng nhập), chạy lại không gửi đôi, vòng 2 thêm đúng một thư; dòng `held`, kênh email, kênh nền tảng không email ⇒ không thư báo.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tenantId, userId } from "@ai/test-kit/builders";
import { cloneDb, inHub, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../lib/db";
import { FakeEmailTransport } from "../notify/adapters/transport.fake";
import type { PartnerMailboxPort } from "../packs/kit/public";
import { partnerNoticeOnce } from "./notice-dispatch";

const A = tenantId(1411);
const B = tenantId(1412);
const D = tenantId(1413); // chưa nối
const UA = userId(1411);
let o: Sql;
let db: Db;

const port: PartnerMailboxPort = {
  receive: async () => 0,
  onReplies: async () => undefined,
  // Mẫu thật thuộc gói (test riêng ở contracts/domain/partner-notice-mail.rules.test.ts); đây chỉ cần cùng dạng để kiểm bộ gửi.
  notice: (i) => ({
    subject: `${i.senderName} gửi hợp đồng ${i.title} cần anh/chị xác nhận`,
    text: `${i.round > 1 ? `bản sửa lần ${i.round} ` : ""}${i.link}`,
    html: "",
  }),
};
const mail = new FakeEmailTransport();
const dispatch = () =>
  partnerNoticeOnce({ db, email: () => mail, baseUrl: "https://app.test.vn", port: () => port });
const asA = <T>(fn: (tx: Sql) => Promise<T>) =>
  inHub({ kind: "user", tenantId: A, userId: UA }, fn);
const PAYLOAD = '{"title":"HĐ mua bán lô 7","sender_name":"Công ty A","message":"Xin xác nhận"}';
/** `hub.partner_send` (hàm DEFINER của hub, như tool gói gọi). */
const sendRow = (o2: {
  toTenant: string | null;
  toEmail: string | null;
  channel: "platform" | "email";
  prev?: string | null;
}) =>
  asA(
    (
      tx,
    ) => tx`select hub.partner_send(${A}::uuid, ${o2.toTenant}::uuid, ${o2.toEmail}, ${o2.channel}, 'hd-1',
      ${PAYLOAD}::text::jsonb, null, null, now() + interval '7 days', ${o2.prev ?? null}::uuid)::text as id`,
  ).then((r) => r[0]?.id as string);

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  await o`insert into admin.tenants (id, key, name, legal_name, tax_code, directory_listed, directory_verified_at)
    values (${A}, 'n-a', 'A', 'Công ty A', '0100000021', true, null), (${B}, 'n-b', 'B', 'Công ty B', '0100000022', true, null),
           (${D}, 'n-d', 'D', 'Công ty D', '0100000023', true, null)`;
  await o`insert into hub.partner_links (from_tenant, to_tenant, requested_at, accepted_at) values (${A}, ${B}, now(), now())`;
}, 180_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-126 · thư báo kênh nền tảng", () => {
  it("không email / kênh email / lần gửi GIỮ ⇒ không thư báo nền tảng", async () => {
    await sendRow({ toTenant: B, toEmail: null, channel: "platform" });
    await sendRow({ toTenant: null, toEmail: "x@doitac.vn", channel: "email" });
    await sendRow({ toTenant: D, toEmail: "d@congty-d.vn", channel: "platform" }); // chưa nối ⇒ held
    const held = await o`select status from hub.partner_mailbox where to_tenant = ${D}`;
    expect(held[0]?.status).toBe("held");
    expect(await dispatch()).toMatchObject({ claimed: 0 });
    expect(mail.sent).toHaveLength(0);
  });

  it("nền tảng + email đã chọn ⇒ đúng MỘT thư báo link vào app, chạy lại không gửi đôi, vòng 2 thêm đúng một thư", async () => {
    const id = await sendRow({ toTenant: B, toEmail: "chon@congty-b.vn", channel: "platform" });
    expect(await dispatch()).toMatchObject({ claimed: 1, sent: 1 });
    expect(await dispatch()).toMatchObject({ claimed: 0 });
    expect(mail.sent).toHaveLength(1);
    const m = mail.sent[0] as { to: string; subject: string; text: string };
    expect(m.to).toBe("chon@congty-b.vn");
    expect(m.subject).toBe("Công ty A gửi hợp đồng HĐ mua bán lô 7 cần anh/chị xác nhận");
    expect(m.text).toContain("https://app.test.vn/contracts/partner-inbox");
    expect(m.text).not.toContain("/partner-reply/");
    const [row] =
      await o`select email_sent_at, status, channel from hub.partner_mailbox where id = ${id}::uuid`;
    expect(row?.email_sent_at).not.toBeNull();
    expect(row?.channel).toBe("platform");

    // B trả lại ⇒ A gửi lại (vòng 2, cùng người nhận) ⇒ thêm đúng một thư
    await o`update hub.partner_mailbox set status = 'replied', outcome = 'returned', replied_by_source = 'receiver_flow',
      reason = 'Sửa giá', replied_at = now() where id = ${id}::uuid`;
    await sendRow({ toTenant: B, toEmail: "chon@congty-b.vn", channel: "platform", prev: id });
    expect(await dispatch()).toMatchObject({ claimed: 1, sent: 1 });
    expect(mail.sent).toHaveLength(2);
    expect((mail.sent[1] as { text: string }).text).toContain("bản sửa lần 2");
  });

  it("lỗi tạm ⇒ nghỉ theo bậc thang rồi thử lại, không mất; không gửi khi thông báo tắt", async () => {
    await sendRow({ toTenant: B, toEmail: "loi@congty-b.vn", channel: "platform" });
    const off = await partnerNoticeOnce({
      db,
      email: () => null,
      baseUrl: "https://app.test.vn",
      port: () => port,
    });
    expect(off).toMatchObject({ claimed: 0 });
    const failing = {
      sendBatch: async () => [{ ok: false as const, permanent: false, code: "smtp_down" }],
    };
    const r = await partnerNoticeOnce({
      db,
      email: () => failing,
      baseUrl: "https://app.test.vn",
      port: () => port,
    });
    expect(r).toMatchObject({ claimed: 1, sent: 0, failed: 1 });
    const [row] =
      await o`select email_sent_at, email_error, email_attempts from hub.partner_mailbox where to_email = 'loi@congty-b.vn'`;
    expect(row).toMatchObject({ email_sent_at: null, email_error: "smtp_down", email_attempts: 1 });
  });
});
