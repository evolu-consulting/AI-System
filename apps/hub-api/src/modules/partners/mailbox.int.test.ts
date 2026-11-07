// CR-124 · q1 · NFR-01 (cách ly) · NFR-02 (idempotent) · FLOW4-FR-07/11/16 · hub 0117 `hub.partner_mailbox` + hàm DEFINER +
// bộ chuyển. Role thật: `hub_api` (scope user / system như `withHubScope`) và role gói `contracts_rw` (như `withPackScope`).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tenantId, userId } from "@ai/test-kit/builders";
import { cloneDb, inHub, inPack, openOwner, pgCode, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../lib/db";
import { receivedEventId, replyEventId } from "./domain/mailbox-events.rules";
import { partnerMoveOnce } from "./mailbox-mover";

const A = tenantId(1301);
const B = tenantId(1302);
const C = tenantId(1303);
const UA = userId(1301);
const UB = userId(1302);
let o: Sql;
let db: Db;

const as = <T>(t: string, u: string, fn: (tx: Sql) => Promise<T>) =>
  inHub({ kind: "user", tenantId: t, userId: u }, fn);
const send = (tx: Sql, from: string, to: string | null, channel = "platform", ref = "ref-a") =>
  tx`select hub.partner_send(${from}::uuid, ${to}::uuid, ${channel === "email" ? "b@x.vn" : null}, ${channel},
    ${ref}, '{"message":"xin xác nhận","sender":"Công ty A"}'::jsonb, null, null,
    now() + interval '7 days', null)::text as id`.then((r) => r[0]?.id as string);
const reply = (
  tx: Sql,
  id: string,
  outcome: string,
  source: string,
  evidence: object | null = null,
) =>
  tx`select hub.partner_reply(${id}::uuid, ${outcome}, ${outcome === "confirmed" ? null : "sai đơn giá"},
    ${source}, ${evidence === null ? null : tx.json(evidence as never)}) as ok`.then(
    (r) => r[0]?.ok as boolean,
  );
const events = (eventId: string) =>
  o<{ tenant_id: string; event: string; ref: string; facts: Record<string, unknown> }[]>`
    select tenant_id::text, event, ref, facts from hub.flow_events where event_id = ${eventId}`;

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  // B đã chấp nhận nhận HĐ từ A (q2/q3 sẽ có hàm ghi); C → B chưa nối, B chặn A → C không áp dụng.
  await o`insert into hub.partner_links (from_tenant, to_tenant, accepted_at) values (${A}, ${B}, now())`;
  await o`insert into hub.partner_links (from_tenant, to_tenant, accepted_at, blocked_at)
    values (${A}, ${C}, now(), now())`;
});
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-124 q1 · NFR-01 cách ly hộp thư", () => {
  it("role gói và scope user không đọc/ghi thẳng bảng", async () => {
    const id = await as(A, UA, (tx) => send(tx, A, B));
    expect(
      await pgCode(() => inPack("contracts", A, (tx) => tx`select 1 from hub.partner_mailbox`)),
    ).toBe("42501");
    expect(
      await pgCode(() =>
        inPack(
          "contracts",
          A,
          (tx) => tx`insert into hub.partner_mailbox (from_tenant, channel, expires_at)
          values (${A}::uuid, 'manual', now() + interval '1 day')`,
        ),
      ),
    ).toBe("42501");
    // hub_rw scope user: không policy ⇒ 0 dòng (kể cả dòng của chính mình), ghi ⇒ 42501.
    const seen = await as(
      A,
      UA,
      (tx) => tx`select id from hub.partner_mailbox where id = ${id}::uuid`,
    );
    expect(seen.length).toBe(0);
    expect(
      await pgCode(() =>
        as(
          A,
          UA,
          (tx) => tx`insert into hub.partner_mailbox (from_tenant, channel, expires_at)
          values (${A}::uuid, 'manual', now() + interval '1 day')`,
        ),
      ),
    ).toBe("42501");
    expect(
      await pgCode(() => as(A, UA, (tx) => tx`update hub.partner_mailbox set status = 'closed'`)),
    ).toBeNull(); // 0 dòng chạm
    const [st] = await o<
      { status: string }[]
    >`select status from hub.partner_mailbox where id = ${id}::uuid`;
    expect(st?.status).toBe("sent");
  });

  it("partner_send giả from_tenant / chưa đặt tenant ⇒ 42501", async () => {
    expect(await pgCode(() => as(A, UA, (tx) => send(tx, C, B)))).toBe("42501");
    expect(await pgCode(() => inHub("none", (tx) => send(tx, A, B)))).toBe("42501");
  });

  it("kênh nền tảng chỉ khi bên nhận đã chấp nhận nối (chưa nối / đã chặn ⇒ 42501)", async () => {
    // q4: chưa có dòng nối ⇒ GIỮ (bên gửi không phân biệt được với chặn trước); không lộ việc đã/chưa bị chặn.
    expect(await pgCode(() => as(C, UA, (tx) => send(tx, C, B)))).toBeNull();
    // q4 (hub 0122): B chặn TRƯỚC khi A xin ⇒ lần gửi được GIỮ im lặng (không lộ việc bị chặn), không tới B.
    expect(await pgCode(() => as(A, UA, (tx) => send(tx, A, C)))).toBeNull();
    const [held] = await o<
      { status: string }[]
    >`select status from hub.partner_mailbox where to_tenant = ${C} order by created_at desc limit 1`;
    expect(held?.status).toBe("held");
    // email/manual không mang tenant nhận ⇒ không có đường receiver_flow.
    expect(
      await pgCode(() =>
        as(
          A,
          UA,
          (tx) => tx`select hub.partner_send(${A}::uuid, ${B}::uuid, 'b@x.vn', 'email',
          null, '{}'::jsonb, null, null, now() + interval '1 day', null)`,
        ),
      ),
    ).toBe("23514");
  });

  it("partner_reply sai tenant ⇒ 42501, mine chỉ thấy dòng của mình, không lộ from_ref cho bên nhận", async () => {
    const id = await as(A, UA, (tx) => send(tx, A, B, "platform", "ref-mine"));
    expect(await pgCode(() => as(C, UA, (tx) => reply(tx, id, "confirmed", "receiver_flow")))).toBe(
      "42501",
    );
    // A là bên gửi: không được trả lời thay bên nhận qua receiver_flow.
    expect(await pgCode(() => as(A, UA, (tx) => reply(tx, id, "confirmed", "receiver_flow")))).toBe(
      "42501",
    );
    const mineA = await as(
      A,
      UA,
      (tx) => tx`select * from hub.partner_mailbox_mine() where id = ${id}::uuid`,
    );
    const mineB = await as(
      B,
      UB,
      (tx) => tx`select * from hub.partner_mailbox_mine() where id = ${id}::uuid`,
    );
    const mineC = await as(
      C,
      UA,
      (tx) => tx`select * from hub.partner_mailbox_mine() where id = ${id}::uuid`,
    );
    expect(mineA.map((r) => [r.direction, r.from_ref])).toEqual([["out", "ref-mine"]]);
    expect(mineB.map((r) => [r.direction, r.from_ref])).toEqual([["in", null]]);
    expect(mineC.length).toBe(0);
    expect(Object.keys(mineB[0] ?? {})).not.toContain("payload");
  });

  it("ghi nhận thủ công chỉ bởi bên gửi có người ghi, kênh manual cần 1–20 tệp bằng chứng, gọi lại cùng kết quả ⇒ false", async () => {
    const id = await as(A, UA, (tx) => send(tx, A, null, "manual"));
    expect(
      await pgCode(() => as(B, UB, (tx) => reply(tx, id, "returned", "manual", { files: ["f1"] }))),
    ).toBe("42501");
    expect(
      await pgCode(() => as(A, UA, (tx) => reply(tx, id, "returned", "manual", { files: [] }))),
    ).toBe("22023");
    const many = { files: Array.from({ length: 21 }, (_, i) => `f${i}`) };
    expect(await pgCode(() => as(A, UA, (tx) => reply(tx, id, "returned", "manual", many)))).toBe(
      "22023",
    );
    // Không có người ghi (app.user_id rỗng) ⇒ 42501.
    expect(
      await pgCode(() => as(A, "", (tx) => reply(tx, id, "returned", "manual", { files: ["f1"] }))),
    ).toBe("42501");
    // recorded_by do người gọi gửi lên bị ghi đè bằng app.user_id.
    expect(
      await as(A, UA, (tx) =>
        reply(tx, id, "returned", "manual", { files: ["f1"], recorded_by: UB }),
      ),
    ).toBe(true);
    expect(await as(A, UA, (tx) => reply(tx, id, "returned", "manual", { files: ["f1"] }))).toBe(
      false,
    );
    expect(
      await pgCode(() =>
        as(A, UA, (tx) => reply(tx, id, "confirmed", "manual", { files: ["f1"] })),
      ),
    ).toBe("55000");
    const [r] = await o<{ status: string; evidence: Record<string, unknown> }[]>`
      select status, evidence from hub.partner_mailbox where id = ${id}::uuid`;
    expect(r?.status).toBe("replied");
    expect(r?.evidence.recorded_by).toBe(UA);
  });
});

describe("CR-124 q1 · NFR-02 bộ chuyển idempotent", () => {
  it("hai worker + chạy lại ⇒ đúng một contract.received (bên nhận) và một partner.returned (bên gửi)", async () => {
    await o`update hub.partner_mailbox set status = 'closed' where status = 'sent'`; // dọn dòng của test trước
    const id = await as(A, UA, (tx) => send(tx, A, B, "platform", "ref-hd-1"));
    const [w1, w2] = await Promise.all([partnerMoveOnce({ db }), partnerMoveOnce({ db })]);
    expect((w1?.delivered ?? 0) + (w2?.delivered ?? 0)).toBe(1);
    expect((await partnerMoveOnce({ db })).delivered).toBe(0);
    // Mất chốt trạng thái (Hub chết sau khi phát) ⇒ chạy lại không phát lần hai.
    await o`update hub.partner_mailbox set status = 'sent' where id = ${id}::uuid`;
    expect((await partnerMoveOnce({ db })).receivedEvents).toBe(0);
    const rec = await events(receivedEventId(id));
    expect(rec.map((e) => [e.tenant_id, e.event, e.ref])).toEqual([[B, "contract.received", id]]);
    expect(Object.keys(rec[0]?.facts ?? {}).sort()).toEqual(["from_tenant", "mailbox_id", "round"]);

    expect(await as(B, UB, (tx) => reply(tx, id, "returned", "receiver_flow"))).toBe(true);
    const [r1, r2] = await Promise.all([partnerMoveOnce({ db }), partnerMoveOnce({ db })]);
    expect((r1?.replyEvents ?? 0) + (r2?.replyEvents ?? 0)).toBe(1);
    await o`update hub.partner_mailbox set reply_emitted_at = null where id = ${id}::uuid`;
    expect((await partnerMoveOnce({ db })).replyEvents).toBe(0);
    const rep = await events(replyEventId(id));
    expect(rep.map((e) => [e.tenant_id, e.event, e.ref])).toEqual([
      [A, "partner.returned", "ref-hd-1"],
    ]);
    expect(rep[0]?.facts.reason).toBe("sai đơn giá");
    // B đã trả lời ⇒ không trả lời lần nữa với kết quả khác.
    expect(await pgCode(() => as(B, UB, (tx) => reply(tx, id, "confirmed", "receiver_flow")))).toBe(
      "55000",
    );
  });

  it("kênh email/manual không giao qua nền tảng; email reply chưa mở (q5)", async () => {
    const id = await as(A, UA, (tx) => send(tx, A, null, "email"));
    expect((await partnerMoveOnce({ db })).delivered).toBe(0);
    expect((await events(receivedEventId(id))).length).toBe(0);
    expect(await pgCode(() => as(A, UA, (tx) => reply(tx, id, "confirmed", "email")))).toBe(
      "0A000",
    );
  });
});
