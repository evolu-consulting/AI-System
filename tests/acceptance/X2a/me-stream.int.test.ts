// HUB-FR-99 · HUB-FR-100 · AC-H25 · X2a-AC08 · X2a-AC12 · realtime `/me/stream` (test-plan X2a §5.4 T01–T16; plan §7, D11–D14;
// readiness R2: `pingMs: 500`). 2 instance = 2 `createApp` cùng DB + Redis test (plan §13 Q7). Mọi frame qua
// `parseMeStreamEvent`. Phòng tạo qua API trong từng `it`; chờ theo điều kiện, không sleep cố định.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createRedis, type Redis } from "../../../apps/hub-api/src/lib/redis";
import { adminChange, REDIS_TEST_URL } from "../H1/_fixtures";
import {
  api,
  type Ctx,
  call,
  cm,
  type HubX2a,
  listItem,
  type MeEv,
  mkGroup,
  msgEv,
  ofRoom,
  openMeStream,
  P,
  Q,
  say,
  sentinel,
  sign,
  startHubX2a,
  startX2a,
  T,
  waitUntil,
} from "./_x2a";

let c: Ctx & { stop: () => Promise<void> };
let hub2: HubX2a;
let redis: Redis;
beforeAll(async () => {
  c = await startX2a({ instanceId: "qc-x2a-1" });
  hub2 = await startHubX2a(c.k, { instanceId: "qc-x2a-2" });
  redis = createRedis(REDIS_TEST_URL);
  await redis.connect();
}, 60_000);
afterAll(async () => {
  redis?.disconnect();
  await hub2?.stop();
  await c?.stop();
});

const G = async () => (await mkGroup(c.hub, await c.tok("lan"), [P.hoa.id, P.tam.id])).id as string;
/** So id Redis Stream theo số (ms, seq). */
const cmpId = (x: string, y: string): number => {
  const [a1 = 0n, a2 = 0n] = x.split("-").map((v) => BigInt(v || 0));
  const [b1 = 0n, b2 = 0n] = y.split("-").map((v) => BigInt(v || 0));
  return a1 === b1 ? Number(a2 - b2) : a1 < b1 ? -1 : 1;
};
const isMsgIn = (room: string) => (e: MeEv) =>
  e.event === "room.message" && e.data?.room_id === room;

describe("T01–T02 · xác thực [X2a-AC12]", () => {
  it("HUB-FR-99 · T01 · không token / token hết hạn / chữ ký khác ⇒ 401 JSON trước khi mở stream [X2a-AC12]", async () => {
    const none = await openMeStream(c.hub, null);
    const expired = await openMeStream(c.hub, await sign(c.k, P.hoa, { expS: -30 }));
    const forged = await openMeStream(c.hub, await sign(c.k, P.hoa, { key: c.k.other }));
    for (const s of [none, expired, forged]) {
      expect(s.status).toBe(401);
      expect(s.headers.get("content-type") ?? "").toContain("application/json");
      expect(s.json?.error?.code).toBeDefined();
    }
  });

  it("HUB-FR-99 · T02 · `?token=<jwt hợp lệ>` không header ⇒ 401; Last-Event-ID qua query bị bỏ qua (không stream.reset) [X2a-AC12]", async () => {
    const t = await c.tok("hoa");
    const q = await openMeStream(c.hub, null, {
      path: `/me/stream?token=${encodeURIComponent(t)}`,
    });
    expect(q.status).toBe(401);
    const s = await openMeStream(c.hub, t, {
      path: "/me/stream?lastEventId=abc&last_event_id=abc",
    });
    expect(s.status).toBe(200);
    expect(await sentinel(c.hub, t, s, "T02")).toBe(true);
    expect(s.events.filter((e) => e.event === "stream.reset")).toEqual([]);
    s.close();
  });
});

describe("T03–T06 · phát, 2 instance, nối lại [AC-H25]", () => {
  it("HUB-FR-99 · T03 · A gửi ⇒ A, B, E nhận room.message cùng message.id; B, E room.unread {unread:1, total đúng}; A unread=0 [AC-H25 · X2a-R17]", async () => {
    const g = await G();
    const [ta, tb, te] = [await c.tok("lan"), await c.tok("hoa"), await c.tok("tam")];
    const ss = [
      await openMeStream(c.hub, ta),
      await openMeStream(c.hub, tb),
      await openMeStream(c.hub, te),
    ];
    expect(ss.map((s) => s.status)).toEqual([200, 200, 200]);
    const m = await say(c.hub, ta, g, "T03");
    const got = await Promise.all(ss.map((s) => s.until(msgEv("T03"), 2_000)));
    expect(got.map((e) => e?.data?.message?.id)).toEqual([m.id, m.id, m.id]);
    const unread = (i: number) =>
      ss[i]?.until((e) => e.event === "room.unread" && e.data?.room_id === g, 2_000);
    const [ua, ub] = [await unread(0), await unread(1)];
    expect(ua?.data?.unread).toBe(0);
    expect(ub?.data?.unread).toBe(1);
    expect(ub?.data?.total).toBe((await api(c.hub, tb, "GET", "/rooms")).json.unread_total);
    for (const s of ss) expect(s.events.every((e) => e.valid)).toBe(true);
    for (const s of ss) s.close();
  });

  it("HUB-FR-99 · T04 · 2 instance: B nối hub1, A gửi qua hub2 ⇒ B nhận room.message + room.unread ≤ 2 s [AC-H25]", async () => {
    const g = await G();
    const sb = await openMeStream(c.hub, await c.tok("hoa"));
    expect(sb.status).toBe(200);
    const t0 = Date.now();
    const r = await api(hub2, await c.tok("lan"), "POST", `/rooms/${g}/messages`, {
      content: "T04 qua hub2",
      client_msg_id: cm(),
    });
    expect(r.status).toBe(201);
    const ev = await sb.until(msgEv("T04 qua hub2"), 2_000);
    const un = await sb.until((e) => e.event === "room.unread" && e.data?.room_id === g, 2_000);
    expect({
      msg: ev !== undefined,
      unread: un?.data?.unread,
      within: Date.now() - t0 <= 2_000,
    }).toEqual({
      msg: true,
      unread: 1,
      within: true,
    });
    sb.close();
  });

  it("HUB-FR-99 · T05 · B ngắt; A gửi 3; B nối hub2 với Last-Event-ID cuối ⇒ đúng 3 room.message theo seq, không lặp/thiếu [AC-H25]", async () => {
    const g = await G();
    const [ta, tb] = [await c.tok("lan"), await c.tok("hoa")];
    const s1 = await openMeStream(c.hub, tb);
    expect(s1.status).toBe(200);
    await say(c.hub, ta, g, "T05-0");
    const last = await s1.until(msgEv("T05-0"), 2_000);
    await s1.until((e) => e.event === "room.unread" && e.data?.room_id === g, 2_000);
    const lastId = s1.events[s1.events.length - 1]?.id ?? "";
    s1.close();
    for (const t of ["T05-1", "T05-2", "T05-3"]) await say(c.hub, ta, g, t);
    const s2 = await openMeStream(hub2, tb, { lastId });
    expect({ ok: last !== undefined, s: s2.status }).toEqual({ ok: true, s: 200 });
    await s2.until(msgEv("T05-3"), 3_000);
    const msgs = s2.events.filter(isMsgIn(g));
    expect(msgs.map((e) => e.data.message.content)).toEqual(["T05-1", "T05-2", "T05-3"]);
    const ids = s2.events.map((e) => e.id).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
    expect(s2.events.filter((e) => e.event === "stream.reset")).toEqual([]);
    s2.close();
  });

  it("HUB-FR-99 · T06 · không Last-Event-ID ⇒ không phát lại sự kiện cũ [plan §7]", async () => {
    const g = await G();
    const tb = await c.tok("hoa");
    await say(c.hub, await c.tok("lan"), g, "T06 cũ");
    const s = await openMeStream(c.hub, tb);
    expect(await sentinel(c.hub, tb, s, "T06")).toBe(true);
    expect(ofRoom(s, g)).toEqual([]);
    s.close();
  });
});

describe("T07–T10 · stream.reset [X2a-AC08]", () => {
  const resetFirst = (s: { events: MeEv[] }) => s.events[0];

  it("HUB-FR-99 · T07 · Last-Event-ID: abc ⇒ frame đầu stream.reset (không id), sau đó vẫn nhận sự kiện mới [X2a-AC08]", async () => {
    const g = await G();
    const s = await openMeStream(c.hub, await c.tok("hoa"), { lastId: "abc" });
    expect(s.status).toBe(200);
    await s.until((e) => e.event === "stream.reset", 2_000);
    expect({ ev: resetFirst(s)?.event, id: resetFirst(s)?.id ?? null }).toEqual({
      ev: "stream.reset",
      id: null,
    });
    await say(c.hub, await c.tok("lan"), g, "T07 sau reset");
    expect(await s.until(msgEv("T07 sau reset"), 2_000)).toBeDefined();
    s.close();
  });

  it("HUB-FR-99 · T08 · id > last-generated-id ⇒ stream.reset [X2a-AC08]", async () => {
    const s = await openMeStream(c.hub, await c.tok("hoa"), { lastId: "99999999999999-0" });
    expect(s.status).toBe(200);
    expect((await s.until(() => true, 2_000))?.event).toBe("stream.reset");
    s.close();
  });

  it("HUB-FR-99 · T09 · id hợp lệ nhưng key không tồn tại (user chưa có sự kiện) ⇒ stream.reset [X2a-AC08]", async () => {
    const q = Q[54] as (typeof Q)[number];
    await redis.del(`ustream:${q.id}`);
    const s = await openMeStream(c.hub, await sign(c.k, q), { lastId: "1-0" });
    expect(s.status).toBe(200);
    expect((await s.until(() => true, 2_000))?.event).toBe("stream.reset");
    s.close();
  });

  it("HUB-FR-99 · T10 · cắt thật > 1100 sự kiện: id cũ (đã bị cắt) ⇒ stream.reset; id sau điểm cắt ⇒ replay đủ 3 tin [X2a-AC08 · plan §14]", async () => {
    const q = Q[53] as (typeof Q)[number];
    const key = `ustream:${q.id}`;
    await redis.del(key);
    const room = "a2a00000-0000-4000-8000-0000000c0010";
    const pipe = redis.pipeline();
    for (let i = 1; i <= 1100; i++)
      pipe.xadd(
        key,
        "MAXLEN",
        "~",
        "1000",
        "*",
        "e",
        JSON.stringify({ event: "room.read", data: { room_id: room, user_id: q.id, seq: i } }),
      );
    const out = await pipe.exec();
    const oldId = String(out?.[0]?.[1] ?? "");
    const a = await c.tok("lan");
    const g = await mkGroup(c.hub, a, [q.id], "T10");
    for (const t of ["T10-1", "T10-2", "T10-3"]) await say(c.hub, a, g.id, t);
    const info = (await redis.call("XINFO", "STREAM", key)) as unknown[];
    const recFirst = String(info[info.indexOf("recorded-first-entry-id") + 1] ?? "");
    const first = (await redis.xrange(key, "-", "+", "COUNT", 1))[0]?.[0] ?? "";
    expect(first !== "" && cmpId(first, oldId) > 0).toBe(true);
    // Redis 7.4: MAXLEN không đổi max-deleted-entry-id (chỉ XDEL) ⇒ chứng minh cắt bằng recorded-first-entry-id
    if (info.includes("recorded-first-entry-id")) expect(cmpId(recFirst, oldId)).toBeGreaterThan(0);
    const tq = await sign(c.k, q);
    const s1 = await openMeStream(c.hub, tq, { lastId: oldId });
    expect(s1.status).toBe(200);
    expect((await s1.until(() => true, 2_000))?.event).toBe("stream.reset");
    s1.close();
    const s2 = await openMeStream(c.hub, tq, { lastId: first });
    await s2.until(msgEv("T10-3"), 3_000);
    expect(s2.events.filter((e) => e.event === "stream.reset")).toEqual([]);
    expect(s2.events.filter(isMsgIn(g.id)).map((e) => e.data.message.content)).toEqual([
      "T10-1",
      "T10-2",
      "T10-3",
    ]);
    s2.close();
  });
});

describe("T11–T16 · vòng đời phiên [X2a-AC12 · spec-isolation §1]", () => {
  it("HUB-FR-99 · T11 · JWT exp 3 s ⇒ server đóng ≤ exp + 2 s; 2 tin lúc đứt; nối lại token mới + Last-Event-ID ⇒ đủ 2, không lặp [X2a-AC12]", async () => {
    const g = await G();
    const a = await c.tok("lan");
    const s1 = await openMeStream(c.hub, await sign(c.k, P.hoa, { expS: 3 }));
    expect(s1.status).toBe(200);
    await say(c.hub, a, g, "T11-0");
    await s1.until(msgEv("T11-0"), 2_000);
    await s1.until((e) => e.event === "room.unread" && e.data?.room_id === g, 2_000);
    expect(await waitUntil(() => s1.isClosed(), 5_500)).toBe(true);
    const lastId = s1.events[s1.events.length - 1]?.id ?? "";
    for (const t of ["T11-1", "T11-2"]) await say(c.hub, a, g, t);
    const s2 = await openMeStream(c.hub, await c.tok("hoa"), { lastId });
    await s2.until(msgEv("T11-2"), 3_000);
    expect(s2.events.filter(isMsgIn(g)).map((e) => e.data.message.content)).toEqual([
      "T11-1",
      "T11-2",
    ]);
    s2.close();
  }, 20_000);

  it("HUB-FR-99 · T12 · B bị khoá khi đang nối ⇒ stream đóng ≤ 2 s (ping 500 ms, accountUsable); nối lại ⇒ 401/403 [X2a-AC12 · G7]", async () => {
    const q = Q[52] as (typeof Q)[number];
    const t = await sign(c.k, q);
    const s = await openMeStream(c.hub, t);
    expect(s.status).toBe(200);
    try {
      await adminChange(
        c.sql,
        "user",
        T.acme,
        (tx) => tx`update admin.users set locked_by_tenant = true where id = ${q.id}`,
      );
      const blocked = await waitUntil(
        async () => [401, 403].includes((await call(c.hub, "GET", "/rooms", { token: t })).status),
        10_000,
      );
      expect(blocked).toBe(true);
      const t0 = Date.now();
      expect(await waitUntil(() => s.isClosed(), 2_000)).toBe(true);
      expect(Date.now() - t0).toBeLessThanOrEqual(2_100);
      const again = await openMeStream(c.hub, t);
      expect([401, 403]).toContain(again.status);
    } finally {
      s.close();
      await adminChange(
        c.sql,
        "user",
        T.acme,
        (tx) => tx`update admin.users set locked_by_tenant = false where id = ${q.id}`,
      );
    }
  }, 30_000);

  it("HUB-FR-99 · T13 · 6 kết nối B cùng instance ⇒ kết nối cũ nhất bị đóng; 5 cái còn lại nhận tin [spec-isolation §1 · plan §7]", async () => {
    const g = await G();
    const tb = await c.tok("hoa");
    const ss: Awaited<ReturnType<typeof openMeStream>>[] = [];
    for (let i = 0; i < 6; i++) ss.push(await openMeStream(c.hub, tb));
    expect(ss.map((s) => s.status)).toEqual([200, 200, 200, 200, 200, 200]);
    expect(await waitUntil(() => ss[0]?.isClosed() === true, 3_000)).toBe(true);
    await say(c.hub, await c.tok("lan"), g, "T13");
    const got = await Promise.all(ss.slice(1).map((s) => s.until(msgEv("T13"), 2_000)));
    expect(got.every((e) => e !== undefined)).toBe(true);
    for (const s of ss) s.close();
  });

  it("HUB-FR-100 · T14 · B 2 tab; đọc ở tab 1 ⇒ cả 2 tab nhận room.unread {unread:0}; A nhận room.read [X2a-AC09 · R19]", async () => {
    const g = await G();
    const [ta, tb] = [await c.tok("lan"), await c.tok("hoa")];
    await say(c.hub, ta, g, "T14");
    const [b1, b2, sa] = [
      await openMeStream(c.hub, tb),
      await openMeStream(hub2, tb),
      await openMeStream(c.hub, ta),
    ];
    expect([b1.status, b2.status, sa.status]).toEqual([200, 200, 200]);
    expect((await api(c.hub, tb, "POST", `/rooms/${g}/read`, { seq: 1 })).status).toBe(200);
    const zero = (e: MeEv) =>
      e.event === "room.unread" && e.data?.room_id === g && e.data?.unread === 0;
    expect([await b1.until(zero, 2_000), await b2.until(zero, 2_000)].every(Boolean)).toBe(true);
    const rd = await sa.until((e) => e.event === "room.read" && e.data?.room_id === g, 2_000);
    expect(rd?.data).toEqual({ room_id: g, user_id: P.hoa.id, seq: 1 });
    for (const s of [b1, b2, sa]) s.close();
  });

  it("HUB-FR-99 · T15 · header text/event-stream + Cache-Control no-cache; có `: ping` trong ≤ 2 s (pingMs 500) [plan §7]", async () => {
    const s = await openMeStream(c.hub, await c.tok("tam"));
    expect(s.status).toBe(200);
    expect(s.headers.get("content-type") ?? "").toContain("text/event-stream");
    expect(s.headers.get("cache-control") ?? "").toContain("no-cache");
    expect(await waitUntil(() => s.text().includes(": ping"), 2_000)).toBe(true);
    s.close();
  });

  it("HUB-FR-99 · T16 · hub có Redis bị ngắt sau khởi động: POST /messages ⇒ 201, DB có tin; GET /rooms của B ⇒ unread đúng từ DB [X2a-R21]", async () => {
    const hub3 = await startHubX2a(c.k, { instanceId: "qc-x2a-3" });
    try {
      const a = await c.tok("lan");
      const g = await mkGroup(hub3, a, [P.hoa.id], "T16");
      hub3.redis.disconnect();
      const r = await api(hub3, a, "POST", `/rooms/${g.id}/messages`, {
        content: "T16 Redis đứt",
        client_msg_id: cm(),
      });
      expect(r.status).toBe(201);
      const [n] =
        await c.sql`select count(*)::int as n from hub.room_messages where room_id = ${g.id}`;
      expect(n?.n).toBe(1);
      expect(await listItem(c.hub, await c.tok("hoa"), g.id)).toMatchObject({
        unread: 1,
        last_seq: 1,
      });
    } finally {
      await hub3.stop().catch(() => undefined);
    }
  });
});
