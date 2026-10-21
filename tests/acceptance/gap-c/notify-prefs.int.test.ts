// gap-c #11 · #12 · tùy chọn thông báo theo người dùng (mốc nhắc hạn, cảnh báo giá, nhận cả HĐ cấp dưới) trong `notify.enqueue`, cô lập giữa
// người dùng, và web push thật qua `createWebPushTransport` với SENDER GIẢ (không bao giờ gửi mạng/email thật).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createWebPushTransport } from "../../../apps/hub-api/src/modules/notify/adapters/webpush.transport";
import { dispatchOnce } from "../../../apps/hub-api/src/modules/notify/application/dispatch.usecase";
import { needNotify, notice, P, resetNotify, send, startWorker, T } from "../N3/_support/n3";
import { api, startX2a } from "../X2a/_x2a";

type Ctx = Awaited<ReturnType<typeof startX2a>>;
let c: Ctx;
beforeAll(async () => {
  c = await startX2a();
  await needNotify(c.sql);
});
afterAll(async () => {
  await c.sql`delete from admin.user_reports where tenant_id = ${T.acme}`;
  await c.stop();
});
beforeEach(async () => {
  await resetNotify(c.sql);
  await c.sql`delete from admin.user_reports where tenant_id = ${T.acme}`;
});
const as = async (who: "lan" | "hoa", method: string, path: string, body?: unknown) =>
  api(c.hub, await c.tok(who), method, path, body);
const titles = async (who: "lan" | "hoa") =>
  ((await as(who, "GET", "/notifications?limit=50")).json.items as { title: string }[])
    .map((i) => i.title)
    .sort();
/** Lời nhắc hạn như vòng HD4 gửi: `lead` = mốc, `managed` = cho phép nhân bản tới quản lý. */
const remind = (user: string, lead: number, extra: Record<string, unknown> = {}) =>
  ({
    ...notice(user, {
      title: `m${lead}`,
      dedup_key: `r:${user}:${lead}`,
      kind: "contract.deadline",
    }),
    lead,
    managed: true,
    ...extra,
  }) as never;

describe("gap-c #11 · tùy chọn → người nhận", () => {
  it("mốc riêng được tôn trọng, mặc định tenant cho người chưa chọn, tùy chọn không rò sang người khác", async () => {
    const put = await as("lan", "PUT", "/notifications/prefs", {
      email: true,
      push: true,
      remind_days: [7, 0],
    });
    expect(put.json).toMatchObject({
      remind_days: [7, 0],
      remind_days_custom: true,
      remind_days_default: [60, 30, 7, 1, 0],
      price_alerts: true,
      include_managed: false,
    });
    await send(T.acme, [
      remind(P.lan.id, 30),
      remind(P.lan.id, 7),
      remind(P.hoa.id, 30),
      remind(P.hoa.id, 7),
    ]);
    expect(await titles("lan")).toEqual(["m7"]); // 30 không nằm trong mốc riêng
    expect(await titles("hoa")).toEqual(["m30", "m7"]); // hoa chưa chọn ⇒ mặc định đủ lưới
    expect((await as("hoa", "GET", "/notifications/prefs")).json).toMatchObject({
      remind_days_custom: false,
    });
    // PUT chỉ email/push KHÔNG làm mất mốc riêng; remind_days: null ⇒ về mặc định
    await as("lan", "PUT", "/notifications/prefs", { email: false, push: true });
    expect((await as("lan", "GET", "/notifications/prefs")).json).toMatchObject({
      email: false,
      remind_days: [7, 0],
    });
    expect(
      (
        await as("lan", "PUT", "/notifications/prefs", {
          email: false,
          push: true,
          remind_days: null,
        })
      ).json,
    ).toMatchObject({ remind_days_custom: false, remind_days: [60, 30, 7, 1, 0] });
    expect(
      (
        await as("lan", "PUT", "/notifications/prefs", {
          email: true,
          push: true,
          remind_days: [14],
        })
      ).status,
    ).toBe(400);
  });

  it("cảnh báo giá tắt ⇒ bỏ kind contract.price*; 'cấp dưới' bật ⇒ quản lý nhận thêm bản của HĐ người mình quản lý", async () => {
    await as("lan", "PUT", "/notifications/prefs", {
      email: true,
      push: true,
      price_alerts: false,
    });
    await send(T.acme, [
      notice(P.lan.id, { title: "giá", kind: "contract.price_alert", dedup_key: "p1" }),
      notice(P.hoa.id, { title: "giá", kind: "contract.price_alert", dedup_key: "p2" }),
    ]);
    expect(await titles("lan")).toEqual([]);
    expect(await titles("hoa")).toEqual(["giá"]);

    // hoa quản lý lan (closure admin.user_reports); mặc định hoa CHƯA bật ⇒ không nhận
    await c.sql`insert into admin.user_reports (tenant_id, manager_id, user_id, depth) values (${T.acme}, ${P.hoa.id}, ${P.lan.id}, 1)`;
    await resetNotify(c.sql);
    await send(T.acme, [remind(P.lan.id, 7)]);
    expect([await titles("lan"), await titles("hoa")]).toEqual([["m7"], []]);
    await as("hoa", "PUT", "/notifications/prefs", {
      email: true,
      push: true,
      include_managed: true,
    });
    await send(T.acme, [remind(P.lan.id, 1)]);
    expect([await titles("lan"), await titles("hoa")]).toEqual([["m1", "m7"], ["m1"]]);
  });
});

describe("gap-c #12 · web push thật với sender giả", () => {
  it("đăng ký → 'Gửi thử' → chỉ endpoint của chính người dùng nhận payload; người khác không", async () => {
    const lanEp = "https://push.example/lan";
    const hoaEp = "https://push.example/hoa";
    const sub = (endpoint: string) => ({
      endpoint,
      keys: { p256dh: "BNc-key_1", auth: "au-th_1" },
    });
    expect((await as("lan", "POST", "/notifications/push/subscriptions", sub(lanEp))).status).toBe(
      204,
    );
    expect((await as("hoa", "POST", "/notifications/push/subscriptions", sub(hoaEp))).status).toBe(
      204,
    );
    const test = await as("lan", "POST", "/notifications/push/test");
    expect(test).toMatchObject({ status: 200, json: { created: 1 } });

    const calls: { endpoint: string; payload: string }[] = [];
    const w = startWorker();
    try {
      const push = createWebPushTransport(
        { publicKey: "pub", subject: "mailto:ops@example.test" },
        async () => "priv",
        async (s, payload) => void calls.push({ endpoint: s.endpoint, payload }),
      );
      await dispatchOnce({ ...w.deps, push });
    } finally {
      await w.stop();
    }
    expect(calls.map((x) => x.endpoint)).toEqual([lanEp]);
    expect(JSON.parse(calls[0]?.payload ?? "{}")).toMatchObject({ title: "Thông báo thử" });
    // gỡ đăng ký: DELETE chỉ xoá của mình
    expect(
      (await as("hoa", "DELETE", "/notifications/push/subscriptions", { endpoint: lanEp })).status,
    ).toBe(204);
    const left = await c.sql`select endpoint from hub.push_subscriptions order by endpoint`;
    expect(left.map((r) => r.endpoint)).toEqual([hoaEp, lanEp]);
  });
});
