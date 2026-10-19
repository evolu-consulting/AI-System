// N3-FR-04 · N3-FR-05 · N3-FR-06 · N3-FR-07 · N3-NFR-02 · N3-NFR-03 · worker gửi trên DB thật + transport giả + đồng hồ giả (không sleep).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { dispatchOnce } from "../../../apps/hub-api/src/modules/notify/application/dispatch.usecase";
import {
  drain,
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
const statusOf = async () =>
  sql<{ channel: string; status: string; attempts: number; last_error: string | null }[]>`
    select channel, status, attempts, last_error from hub.notification_deliveries order by id`;
const subscribe = (tid: string, uid: string, endpoint: string) =>
  sql`insert into hub.push_subscriptions (tenant_id, user_id, endpoint, p256dh, auth) values (${tid}, ${uid}, ${endpoint}, 'k', 'a')`;

describe("N3-FR-05 · chia kênh theo tùy chọn và địa chỉ thật", () => {
  it("email cho người có địa chỉ; push chỉ khi có đăng ký; nội dung đúng, khóa idempotency theo id bản gửi", async () => {
    await subscribe(T.acme, P.hoa.id, "https://push.example/hoa");
    await send(T.acme, [
      notice(P.lan.id, {
        title: "Hợp đồng sắp hết hạn",
        body: "còn 30 ngày",
        link: "/contracts/7",
      }),
      notice(P.hoa.id),
    ]);
    const r = await dispatchOnce(w.deps);
    expect(r).toMatchObject({ fanned: 2, claimed: 3, sent: 3 });
    expect(w.email.sent.map((m) => m.to).sort()).toEqual(["hoa@example.test", "lan@example.test"]);
    const mail = w.email.sent.find((m) => m.to === "lan@example.test");
    expect(mail).toMatchObject({
      subject: "Hợp đồng sắp hết hạn",
      text: "còn 30 ngày\n\nhttps://app.example/contracts/7",
      tenantId: T.acme,
    });
    expect(mail?.idempotencyKey).toMatch(/^n3-\d+$/);
    expect(w.push.sent.map((m) => m.endpoint)).toEqual(["https://push.example/hoa"]);
    expect((await statusOf()).every((d) => d.status === "sent")).toBe(true);
  });

  it("tùy chọn email=false ⇒ không có bản gửi email (in-app vẫn còn); push=false ⇒ không push", async () => {
    await subscribe(T.acme, P.lan.id, "https://push.example/lan");
    await sql`insert into hub.notify_prefs (tenant_id, user_id, email, push) values (${T.acme}, ${P.lan.id}, false, false)`;
    await send(T.acme, [notice(P.lan.id)]);
    const r = await drain(w.deps);
    expect(r.claimed).toBe(0);
    expect(w.email.sent).toHaveLength(0);
    expect(w.push.sent).toHaveLength(0);
    const [n] = await sql<
      { n: number }[]
    >`select count(*)::int as n from hub.notifications where fanout_at is not null`;
    expect(n?.n).toBe(1);
  });

  it("người bị khóa / không hoạt động không nhận email; thông báo in-app vẫn được ghi", async () => {
    await send(T.acme, [notice(P.khoa.id), notice(P.nghi.id)]);
    const r = await drain(w.deps);
    expect(r.claimed).toBe(0);
    const [n] = await sql<{ n: number }[]>`select count(*)::int as n from hub.notifications`;
    expect(n?.n).toBe(2);
  });

  it("gửi lại cùng dedup_key ⇒ vẫn đúng một email", async () => {
    const dup = notice(P.lan.id, { dedup_key: "hd-9:30" });
    await send(T.acme, [dup]);
    await send(T.acme, [dup]);
    await drain(w.deps);
    expect(w.email.sent).toHaveLength(1);
  });
});

describe("N3-NFR-02 · gửi theo tenant", () => {
  it("lô lẫn hai tenant: mỗi tin mang đúng tenant của người nhận; không địa chỉ/endpoint chéo", async () => {
    await subscribe(T.beta, P.an.id, "https://push.example/an");
    await send(T.acme, [notice(P.lan.id)]);
    await send(T.beta, [notice(P.an.id)]);
    await drain(w.deps);
    const mails = w.email.sent.map((m) => [m.to, m.tenantId]).sort();
    expect(mails).toEqual([
      ["an@example.test", T.beta],
      ["lan@example.test", T.acme],
    ]);
    expect(w.push.sent.map((m) => [m.endpoint, m.tenantId])).toEqual([
      ["https://push.example/an", T.beta],
    ]);
  });

  it("đăng ký push của người khác tenant không bao giờ được dùng cho người này", async () => {
    await subscribe(T.beta, P.an.id, "https://push.example/an");
    await send(T.acme, [notice(P.lan.id)]); // lan không có đăng ký
    await drain(w.deps);
    expect(w.push.sent).toHaveLength(0);
  });
});

describe("N3-FR-06 · thử lại có backoff", () => {
  it("lỗi tạm: 1′ → 5′ → 30′ → 2h, lần 5 ⇒ dead; chưa tới hạn thì không gửi lại", async () => {
    w.email.script = () => ({ ok: false, permanent: false, code: "smtp_451" });
    await send(T.acme, [notice(P.lan.id)]);
    expect((await dispatchOnce(w.deps)).retried).toBe(1);
    expect((await statusOf())[0]).toMatchObject({
      status: "pending",
      attempts: 1,
      last_error: "smtp_451",
    });
    w.clock.advance(59);
    expect((await dispatchOnce(w.deps)).claimed).toBe(0); // chưa tới 60 s
    for (const wait of [2, 300, 1800, 7200]) {
      w.clock.advance(wait);
      await dispatchOnce(w.deps);
    }
    expect((await statusOf())[0]).toMatchObject({
      status: "dead",
      attempts: 5,
      last_error: "smtp_451",
    });
    w.clock.advance(100_000);
    expect((await dispatchOnce(w.deps)).claimed).toBe(0); // dead không bao giờ gửi lại
  });

  it("thử lại rồi thành công: sent, attempts=2, đúng 1 thư đến nơi", async () => {
    let calls = 0;
    w.email.script = () =>
      calls++ === 0 ? { ok: false, permanent: false, code: "smtp_451" } : undefined;
    await send(T.acme, [notice(P.lan.id)]);
    await dispatchOnce(w.deps);
    w.clock.advance(61);
    await dispatchOnce(w.deps);
    expect((await statusOf())[0]).toMatchObject({ status: "sent", attempts: 2 });
    expect(w.email.sent).toHaveLength(1);
  });

  it("lỗi vĩnh viễn ⇒ dead ngay lần 1; transport ném lỗi mạng ⇒ retry, mã không chứa nội dung", async () => {
    w.email.script = (to) =>
      to.startsWith("lan")
        ? { ok: false, permanent: true, code: "SMTP 550 No such user" }
        : undefined;
    await send(T.acme, [notice(P.lan.id), notice(P.hoa.id)]);
    await dispatchOnce(w.deps);
    const rows = await sql<{ status: string; last_error: string }[]>`
      select d.status, d.last_error from hub.notification_deliveries d join admin.users u on u.id = d.user_id where u.username = 'lan'`;
    expect(rows[0]).toEqual({ status: "dead", last_error: "smtp_550_no_such_user" });

    await resetNotify(sql);
    w.email.script = () => undefined;
    w.email.failNext = new TypeError("ECONNRESET lan@example.test");
    await send(T.acme, [notice(P.lan.id)]);
    await dispatchOnce(w.deps);
    const [d] = await statusOf();
    expect(d).toMatchObject({ status: "pending", last_error: "transport_typeerror" });
    expect(JSON.stringify(d)).not.toContain("example.test");
  });

  it("push 410 (đăng ký hết hạn) ⇒ xóa đăng ký; không còn push cho người đó", async () => {
    await subscribe(T.acme, P.lan.id, "https://push.example/gone");
    await subscribe(T.acme, P.lan.id, "https://push.example/ok");
    w.push.script = (ep) =>
      ep.endsWith("gone")
        ? { ok: false, permanent: true, code: "push_410", gone: true }
        : undefined;
    await send(T.acme, [notice(P.lan.id)]);
    await dispatchOnce(w.deps);
    const subs = await sql<{ endpoint: string }[]>`select endpoint from hub.push_subscriptions`;
    expect(subs.map((s) => s.endpoint)).toEqual(["https://push.example/ok"]);
    const push = (await statusOf()).find((d) => d.channel === "push");
    expect(push?.status).toBe("sent"); // còn một đăng ký nhận được
  });
});

describe("N3-FR-06 · crash giữa chừng và nhiều instance", () => {
  it("claim mà chưa ghi kết cục: trước hạn thuê không ai nhận lại; quá hạn thì lô khác nhận lại", async () => {
    await send(T.acme, [notice(P.lan.id)]);
    const now = () => new Date(w.clock.ms).toISOString();
    await w.deps.store.fanout(now(), 100);
    const first = await w.deps.store.claim(now(), 100, 120, 5);
    expect(first).toHaveLength(1); // "instance A" claim rồi chết
    w.clock.advance(119);
    expect((await dispatchOnce(w.deps)).claimed).toBe(0);
    w.clock.advance(2);
    const r = await dispatchOnce(w.deps);
    expect(r).toMatchObject({ claimed: 1, sent: 1 });
    expect((await statusOf())[0]).toMatchObject({ status: "sent", attempts: 2 });
  });

  it("hai worker chạy song song trên 60 bản gửi: mỗi bản gửi đúng một lần (SKIP LOCKED)", async () => {
    const w2 = startWorker({ batchSize: 10 });
    w2.clock.ms = w.clock.ms;
    const base = startWorker({ batchSize: 10 });
    base.clock.ms = w.clock.ms;
    try {
      const rows = Array.from({ length: 60 }, (_, i) =>
        notice(i % 2 ? P.lan.id : P.hoa.id, { dedup_key: `k${i}` }),
      );
      await send(T.acme, rows);
      await Promise.all([drain(base.deps, 50), drain(w2.deps, 50)]);
      const keys = [...base.email.sent, ...w2.email.sent].map((m) => m.idempotencyKey);
      expect(keys).toHaveLength(60);
      expect(new Set(keys).size).toBe(60);
      const [st] = await sql<
        { n: number }[]
      >`select count(*)::int as n from hub.notification_deliveries where status = 'sent'`;
      expect(st?.n).toBe(60);
    } finally {
      await w2.stop();
      await base.stop();
    }
  });
});

describe("N3-NFR-01 · số câu SQL cố định mỗi lô", () => {
  it("lô 3 và lô 100 đều đúng 3 câu (chia kênh, nhận, ghi kết cục); transport gọi 1 lần mỗi kênh", async () => {
    await send(T.acme, [notice(P.lan.id), notice(P.hoa.id), notice(P.tam.id)]);
    const small = await w.count(() => dispatchOnce(w.deps));
    await send(
      T.acme,
      Array.from({ length: 100 }, (_, i) => notice(P.lan.id, { dedup_key: `b${i}` })),
    );
    w.email.calls = 0;
    const big = await w.count(() => dispatchOnce(w.deps));
    expect(small.r.sent).toBe(3);
    expect(big.r.sent).toBe(100);
    expect({ small: small.n, big: big.n }).toEqual({ small: 3, big: 3 });
    expect(w.email.calls).toBe(1);
  });

  it("không có việc ⇒ 2 câu (chia kênh, nhận), không gọi transport, không câu ghi kết cục", async () => {
    const idle = await w.count(() => dispatchOnce(w.deps));
    expect(idle.n).toBe(2);
    expect(w.email.calls + w.push.calls).toBe(0);
  });
});
