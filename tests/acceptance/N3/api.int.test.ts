// N3-FR-04 · N3-FR-09 · N3-NFR-02 · route `/notifications` của hub-api THẬT (in-process, DB thật): chuông, đã đọc, tùy chọn, đăng ký push.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { api, startX2a } from "../X2a/_x2a";
import { needNotify, notice, P, resetNotify, send, T } from "./_support/n3";

type Ctx = Awaited<ReturnType<typeof startX2a>>;
let c: Ctx;
beforeAll(async () => {
  c = await startX2a();
  await needNotify(c.sql);
});
afterAll(async () => {
  await c.stop();
});
beforeEach(async () => {
  await resetNotify(c.sql);
});
const as = async (who: "lan" | "hoa" | "an", method: string, path: string, body?: unknown) =>
  api(c.hub, await c.tok(who), method, path, body);
const sub = (endpoint = "https://push.example/x") => ({
  endpoint,
  keys: { p256dh: "BNc-key_1", auth: "au-th_1" },
});

describe("N3-FR-09 · đọc chuông", () => {
  it("không token ⇒ 401; chỉ thấy thông báo của MÌNH, mới nhất trước, kèm số chưa đọc", async () => {
    expect((await fetch(`${c.hub.base}/notifications`)).status).toBe(401);
    await send(T.acme, [
      notice(P.lan.id, { title: "một", dedup_key: "1", link: "/contracts/1" }),
      notice(P.hoa.id, { title: "của hoa", dedup_key: "h" }),
      notice(P.lan.id, { title: "hai", dedup_key: "2" }),
    ]);
    await send(T.beta, [notice(P.an.id, { title: "của an" })]);
    const r = await as("lan", "GET", "/notifications");
    expect(r.status).toBe(200);
    expect(r.json.items.map((i: { title: string }) => i.title)).toEqual(["hai", "một"]);
    expect(r.json).toMatchObject({ unread: 2, next_before: null });
    expect(r.json.items[1]).toMatchObject({
      link: "/contracts/1",
      read: false,
      source: "pkdemo",
      kind: "demo.note",
    });
    expect(Object.keys(r.json.items[0]).sort()).toEqual(
      ["body", "created_at", "id", "kind", "link", "read", "seq", "source", "title"].sort(),
    ); // không lộ tenant_id/user_id/dedup_key
    expect(
      (await as("an", "GET", "/notifications")).json.items.map((i: { title: string }) => i.title),
    ).toEqual(["của an"]);
  });

  it("phân trang theo con trỏ seq: limit=2 ⇒ next_before; trang sau không trùng; hết ⇒ null", async () => {
    await send(
      T.acme,
      Array.from({ length: 5 }, (_, i) => notice(P.lan.id, { title: `t${i}`, dedup_key: `k${i}` })),
    );
    const p1 = (await as("lan", "GET", "/notifications?limit=2")).json;
    expect(p1.items.map((i: { title: string }) => i.title)).toEqual(["t4", "t3"]);
    const p2 = (await as("lan", "GET", `/notifications?limit=2&before=${p1.next_before}`)).json;
    expect(p2.items.map((i: { title: string }) => i.title)).toEqual(["t2", "t1"]);
    const p3 = (await as("lan", "GET", `/notifications?limit=2&before=${p2.next_before}`)).json;
    expect(p3.items.map((i: { title: string }) => i.title)).toEqual(["t0"]);
    expect(p3.next_before).toBeNull();
  });

  it("thứ tự lô = thứ tự seq: 40 thông báo xen người nhận ngoài tenant ⇒ chuông trả đúng thứ tự ngược đầu vào", async () => {
    const rows = Array.from({ length: 40 }, (_, i) =>
      i % 5 === 4
        ? notice(P.an.id, { title: `ngoài${i}`, dedup_key: `o${i}` }) // an thuộc tenant beta: bị bỏ qua
        : notice(P.lan.id, { title: `m${i}`, dedup_key: `m${i}` }),
    );
    await send(T.acme, rows);
    const r = await as("lan", "GET", "/notifications?limit=50");
    const want = rows
      .filter((_, i) => i % 5 !== 4)
      .map((n) => n.title)
      .reverse();
    expect(r.json.items.map((i: { title: string }) => i.title)).toEqual(want);
  });

  it("tham số sai ⇒ 400 VALIDATION_ERROR (limit 0/51, before 0, khóa lạ); tenant_id/user_id trong query bị BỎ QUA (không đổi người xem)", async () => {
    await send(T.beta, [notice(P.an.id)]);
    const ignored = await as("lan", "GET", `/notifications?tenant_id=${T.beta}&user_id=${P.an.id}`);
    expect(ignored.json.items).toEqual([]);
    for (const q of ["limit=0", "limit=51", "before=0", "foo=1"]) {
      const r = await as("lan", "GET", `/notifications?${q}`);
      expect({ q, status: r.status, code: r.json?.error?.code ?? r.json?.code }).toEqual({
        q,
        status: 400,
        code: "VALIDATION_ERROR",
      });
    }
  });
});

describe("N3-FR-09 · đánh dấu đã đọc", () => {
  it("theo id (chỉ của mình), rồi tất cả; id của người khác ⇒ updated 0 và không đổi", async () => {
    await send(T.acme, [
      notice(P.lan.id, { dedup_key: "1" }),
      notice(P.lan.id, { dedup_key: "2" }),
      notice(P.hoa.id, { dedup_key: "h" }),
    ]);
    const list = (await as("lan", "GET", "/notifications")).json;
    const [a, b] = list.items as { id: string }[];
    const hoaId = (await as("hoa", "GET", "/notifications")).json.items[0].id;
    expect((await as("lan", "POST", "/notifications/read", { ids: [hoaId] })).json).toEqual({
      updated: 0,
    });
    expect((await as("hoa", "GET", "/notifications")).json.unread).toBe(1);
    expect((await as("lan", "POST", "/notifications/read", { ids: [a?.id] })).json).toEqual({
      updated: 1,
    });
    expect((await as("lan", "GET", "/notifications")).json.unread).toBe(1);
    expect((await as("lan", "POST", "/notifications/read", { all: true })).json).toEqual({
      updated: 1,
    });
    const after = (await as("lan", "GET", "/notifications")).json;
    expect(after.unread).toBe(0);
    expect(after.items.every((i: { read: boolean }) => i.read)).toBe(true);
    expect(b).toBeDefined();
  });

  it("body sai ⇒ 400: rỗng, cả ids lẫn all, id không phải uuid, khóa lạ", async () => {
    for (const body of [
      {},
      { ids: ["a1000000-0000-4000-8000-000000000001"], all: true },
      { ids: ["x"] },
      { all: true, tenant_id: "x" },
      { ids: [] },
    ]) {
      expect((await as("lan", "POST", "/notifications/read", body)).status).toBe(400);
    }
  });
});

describe("N3-FR-04 · tùy chọn kênh", () => {
  it("mặc định bật cả hai; PUT lưu; người khác không bị ảnh hưởng; body lạ ⇒ 400", async () => {
    expect((await as("lan", "GET", "/notifications/prefs")).json).toMatchObject({
      email: true,
      push: true,
    });
    expect(
      (await as("lan", "PUT", "/notifications/prefs", { email: false, push: true })).json,
    ).toMatchObject({ email: false, push: true });
    expect((await as("lan", "GET", "/notifications/prefs")).json).toMatchObject({
      email: false,
      push: true,
    });
    expect((await as("hoa", "GET", "/notifications/prefs")).json).toMatchObject({
      email: true,
      push: true,
    });
    expect((await as("lan", "PUT", "/notifications/prefs", { email: false })).status).toBe(400);
    expect((await as("lan", "PUT", "/notifications/prefs", { email: 1, push: true })).status).toBe(
      400,
    );
    expect(
      (await as("lan", "PUT", "/notifications/prefs", { email: true, push: true, user_id: "x" }))
        .status,
    ).toBe(400);
  });
});

describe("N3-FR-07 · đăng ký push", () => {
  const rows = async () => [
    ...(await c.sql<{ tenant_id: string; user_id: string; endpoint: string }[]>`
      select tenant_id, user_id, endpoint from hub.push_subscriptions order by endpoint`),
  ];

  it("khóa công khai VAPID (chưa cấu hình ⇒ null); đăng ký gắn tenant/user của TOKEN; trùng endpoint ⇒ không nhân đôi", async () => {
    expect((await as("lan", "GET", "/notifications/push/key")).json).toEqual({ public_key: null });
    expect((await as("lan", "POST", "/notifications/push/subscriptions", sub())).status).toBe(204);
    expect((await as("lan", "POST", "/notifications/push/subscriptions", sub())).status).toBe(204);
    expect(await rows()).toEqual([
      { tenant_id: T.acme, user_id: P.lan.id, endpoint: "https://push.example/x" },
    ]);
  });

  it("cùng trình duyệt đăng nhập người khác ⇒ endpoint chuyển sang người mới (không còn nhận thông báo của người cũ)", async () => {
    await as("lan", "POST", "/notifications/push/subscriptions", sub());
    await as("an", "POST", "/notifications/push/subscriptions", sub());
    expect(await rows()).toEqual([
      { tenant_id: T.beta, user_id: P.an.id, endpoint: "https://push.example/x" },
    ]);
  });

  it("hủy chỉ xóa của mình; endpoint http / khóa sai ký tự / khóa lạ ⇒ 400", async () => {
    await as("lan", "POST", "/notifications/push/subscriptions", sub("https://push.example/a"));
    await as("hoa", "POST", "/notifications/push/subscriptions", sub("https://push.example/b"));
    expect(
      (
        await as("lan", "DELETE", "/notifications/push/subscriptions", {
          endpoint: "https://push.example/b",
        })
      ).status,
    ).toBe(204);
    expect((await rows()).map((r) => r.endpoint)).toEqual([
      "https://push.example/a",
      "https://push.example/b",
    ]); // của hoa còn nguyên
    expect(
      (
        await as("lan", "DELETE", "/notifications/push/subscriptions", {
          endpoint: "https://push.example/a",
        })
      ).status,
    ).toBe(204);
    expect((await rows()).map((r) => r.endpoint)).toEqual(["https://push.example/b"]);
    const bad = [
      sub("http://push.example/x"),
      { endpoint: "https://push.example/x", keys: { p256dh: "a b", auth: "ok" } },
      { ...sub(), tenant_id: T.beta },
    ];
    for (const b of bad)
      expect((await as("lan", "POST", "/notifications/push/subscriptions", b)).status).toBe(400);
  });
});
