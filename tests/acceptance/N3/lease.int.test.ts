// N3-FR-06 · review N3 M1/M2 · fencing theo lượt claim, trần 5 lần khi claim lại sau hết hạn thuê, hạn transport < lease.
// Đồng hồ giả (không sleep); riêng ca timeout dùng hạn 20 ms với transport không bao giờ trả lời.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { dispatchOnce } from "../../../apps/hub-api/src/modules/notify/application/dispatch.usecase";
import {
  needNotify,
  notice,
  P,
  resetNotify,
  type Sql,
  send,
  setupX2a,
  startWorker,
  T,
  type Worker,
} from "./_support/n3";

let sql: Sql;
let w: Worker;
beforeAll(async () => {
  sql = await setupX2a();
  await needNotify(sql);
});
afterAll(async () => {
  await sql.end();
});
beforeEach(async () => {
  await resetNotify(sql);
  w = startWorker();
});
afterEach(async () => {
  await w.stop();
});
const now = () => new Date(w.clock.ms).toISOString();
const rowsOf = () =>
  sql<{ id: string; status: string; attempts: number; last_error: string | null }[]>`
    select id::text, status, attempts, last_error from hub.notification_deliveries order by id`;

describe("M1 · settle của lượt claim cũ không ghi đè lượt mới", () => {
  it("A claim, hết hạn thuê, B claim lại; A settle muộn ⇒ không đổi hàng; B settle bình thường", async () => {
    await send(T.acme, [notice(P.lan.id)]);
    await w.deps.store.fanout(now(), 100);
    const [a] = await w.deps.store.claim(now(), 100, { leaseSec: 120, maxAttempts: 5 });
    w.clock.advance(121);
    const [b] = await w.deps.store.claim(now(), 100, { leaseSec: 120, maxAttempts: 5 });
    expect([a?.attempts, b?.attempts]).toEqual([1, 2]);
    const stale = await w.deps.store.settle(
      now(),
      [{ id: a?.id ?? "", attempts: 1, outcome: "retry", error: "x", nextAt: now() }],
      [],
    );
    expect(stale).toBe(0);
    expect((await rowsOf())[0]).toMatchObject({ status: "sending", attempts: 2 });
    const fresh = await w.deps.store.settle(
      now(),
      [{ id: b?.id ?? "", attempts: 2, outcome: "sent", error: null, nextAt: null }],
      [],
    );
    expect(fresh).toBe(1);
    expect((await rowsOf())[0]).toMatchObject({ status: "sent", attempts: 2 });
  });
});

describe("M2 · trần số lần thử khi claim lại sau hết hạn thuê", () => {
  it("bản gửi đã đủ 5 lần mà worker chết ⇒ dead 'lease_expired', không gửi lần 6; tin tenant khác vẫn đi", async () => {
    await send(T.acme, [notice(P.lan.id, { dedup_key: "bad" })]);
    await send(T.beta, [notice(P.an.id, { dedup_key: "ok" })]);
    await w.deps.store.fanout(now(), 100);
    await sql`update hub.notification_deliveries d set status = 'sending', attempts = 5, next_attempt_at = ${now()}::timestamptz
      from hub.notifications n where n.id = d.notification_id and n.tenant_id = ${T.acme}::uuid`;
    w.clock.advance(1);
    const r = await dispatchOnce(w.deps);
    expect(r.sent).toBe(1);
    expect(w.email.sent.map((m) => m.to)).toEqual(["an@example.test"]);
    const bad = (await rowsOf()).find((x) => x.status === "dead");
    expect(bad).toMatchObject({ attempts: 5, last_error: "lease_expired" });
  });

  it("hàng ở trần CHECK (attempts=20) không làm câu claim lỗi cho mọi tenant", async () => {
    await send(T.acme, [notice(P.lan.id, { dedup_key: "x" })]);
    await w.deps.store.fanout(now(), 100);
    await sql`update hub.notification_deliveries set status = 'sending', attempts = 20, next_attempt_at = ${now()}::timestamptz`;
    w.clock.advance(1);
    await expect(dispatchOnce(w.deps)).resolves.toMatchObject({ claimed: 0 });
    expect((await rowsOf())[0]).toMatchObject({ status: "dead", last_error: "lease_expired" });
  });
});

describe("M1 · hạn transport", () => {
  it("transport không trả lời ⇒ hết hạn, cả lô thử lại với mã transport_timeout (không treo worker)", async () => {
    w.email.sendBatch = () => new Promise(() => {});
    w.deps.transportTimeoutMs = 20;
    await send(T.acme, [notice(P.lan.id)]);
    const r = await dispatchOnce(w.deps);
    expect(r).toMatchObject({ claimed: 1, retried: 1 });
    expect((await rowsOf())[0]).toMatchObject({
      status: "pending",
      last_error: "transport_timeout",
    });
  });
});
