// CR-124 · q3 · FLOW4-FR-07/11 · NFR-02 · bộ chuyển hộp thư CÓ cổng gói (kit `PartnerMailboxPort`): mỗi tenant nhận gọi `receive` một lần mỗi lượt,
// trả lời ⇒ `onReplies` TRƯỚC khi chốt `reply_emitted_at` (gói lỗi ⇒ không chốt, lượt sau thử lại), phát `partner.*` đúng một lần. Cổng giả — phần
// gói (HĐ nhận, tín hiệu) test ở packs/contracts/partner-mailbox.int.test.ts. Không cổng ⇒ đường q1 (mailbox.int.test.ts).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tenantId, userId } from "@ai/test-kit/builders";
import { cloneDb, inHub, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../lib/db";
import type { PartnerMailboxPort, PartnerReplyRow } from "../packs/kit/public";
import { partnerMoveOnce } from "./mailbox-mover";

const A = tenantId(1341);
const B = tenantId(1342);
const UA = userId(1341);
const UB = userId(1342);
let o: Sql;
let db: Db;
let mailboxId = "";
const received: string[] = [];
const replied: PartnerReplyRow[][] = [];
let failReplies = false;
const port: PartnerMailboxPort = {
  receive: async (t) => {
    received.push(t);
    return 0;
  },
  onReplies: async (rows) => {
    if (failReplies) throw new Error("gói lỗi");
    replied.push([...rows]);
  },
};
const move = () => partnerMoveOnce({ db, port: () => port });

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  await o`insert into hub.partner_links (from_tenant, to_tenant, accepted_at) values (${A}, ${B}, now())`;
  mailboxId = await inHub({ kind: "user", tenantId: A, userId: UA }, (tx) =>
    tx`select hub.partner_send(${A}::uuid, ${B}::uuid, null, 'platform', 'ref-a', '{"title":"HĐ"}'::jsonb, null, null,
      now() + interval '7 days', null)::text as id`.then((r) => r[0]?.id as string),
  );
});
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-124 q3 · bộ chuyển có cổng gói", () => {
  it("lần gửi 'sent' kênh nền tảng ⇒ gọi cổng nhận đúng tenant B, KHÔNG tự đẩy sự kiện (gói làm cùng tx)", async () => {
    await move();
    expect(received).toEqual([B]);
    const ev = await o`select 1 from hub.flow_events where event = 'contract.received'`;
    expect(ev).toHaveLength(0); // cổng giả không tạo HĐ nhận ⇒ không sự kiện; đường q1 (deliverSent) không chạy khi có cổng
  });

  it("trả lời: gói lỗi ⇒ không chốt reply_emitted_at; gói ổn ⇒ báo một lần + phát partner.confirmed đúng một lần", async () => {
    await o`update hub.partner_mailbox set status = 'delivered' where id = ${mailboxId}::uuid`;
    await inHub(
      { kind: "user", tenantId: B, userId: UB },
      (tx) =>
        tx`select hub.partner_reply(${mailboxId}::uuid, 'confirmed', null, 'receiver_flow', null)`,
    );
    failReplies = true;
    await expect(move()).rejects.toThrow("gói lỗi");
    const [m1] =
      await o`select reply_emitted_at from hub.partner_mailbox where id = ${mailboxId}::uuid`;
    expect(m1?.reply_emitted_at).toBeNull();
    failReplies = false;
    const s = await move();
    expect(s.replyEvents).toBe(1);
    expect(replied).toHaveLength(1);
    expect(replied[0]?.[0]).toMatchObject({
      mailboxId,
      tenantId: A,
      ref: "ref-a",
      outcome: "confirmed",
      source: "receiver_flow",
    });
    await move();
    expect(replied).toHaveLength(1);
    const ev =
      await o`select tenant_id::text as t, event from hub.flow_events where event = 'partner.confirmed'`;
    expect(ev.map((r) => [r.t, r.event])).toEqual([[A, "partner.confirmed"]]);
  });
});
