// gap-c #12 · điều phối web push phía trình duyệt (không cần trình duyệt: `PushDeps` giả).
import { describe, expect, it } from "bun:test";
import {
  disablePush,
  enablePush,
  isSubscribed,
  type PushDeps,
  subscriptionBody,
  urlBase64ToUint8Array,
} from "./push";

const SUB = { endpoint: "https://push.example/x", keys: { p256dh: "BNc-key_1", auth: "au-th_1" } };
function deps(o: Partial<PushDeps> = {}): PushDeps & { saved: unknown[]; removed: string[] } {
  const saved: unknown[] = [];
  const removed: string[] = [];
  return {
    secure: true,
    supported: true,
    swUrl: "/push-sw.js",
    permission: () => "default",
    requestPermission: async () => "granted",
    vapidKey: async () => "AQAB",
    subscribe: async () => SUB,
    unsubscribe: async () => SUB.endpoint,
    current: async () => SUB,
    save: async (b) => void saved.push(b),
    remove: async (e) => void removed.push(e),
    ...o,
    saved,
    removed,
  };
}

describe("web push", () => {
  it("urlBase64ToUint8Array: base64url có/không đệm", () => {
    expect([...urlBase64ToUint8Array("AQAB")]).toEqual([1, 0, 1]);
    expect([...urlBase64ToUint8Array("-_8")]).toEqual([251, 255]);
  });
  it("subscriptionBody: chỉ https + đủ hai khoá", () => {
    expect(subscriptionBody(SUB)).toEqual(SUB);
    expect(subscriptionBody({ ...SUB, endpoint: "http://x" })).toBeNull();
    expect(subscriptionBody({ endpoint: SUB.endpoint, keys: { p256dh: "a" } })).toBeNull();
  });
  it("bật: HTTP thường ⇒ insecure; không hỗ trợ ⇒ unsupported; KHÔNG xin quyền khi chưa đủ điều kiện", async () => {
    let asked = 0;
    const ask = async () => {
      asked++;
      return "granted" as const;
    };
    expect(await enablePush(deps({ secure: false, requestPermission: ask }))).toBe("insecure");
    expect(await enablePush(deps({ supported: false, requestPermission: ask }))).toBe(
      "unsupported",
    );
    expect(asked).toBe(0);
  });
  it("bật: từ chối quyền ⇒ denied (không lưu); thiếu khoá VAPID ⇒ no_key; thành công ⇒ lưu đúng body", async () => {
    const d1 = deps({ requestPermission: async () => "denied" });
    expect(await enablePush(d1)).toBe("denied");
    expect(d1.saved).toEqual([]);
    expect(await enablePush(deps({ vapidKey: async () => null }))).toBe("no_key");
    const ok = deps();
    expect(await enablePush(ok)).toBe("ok");
    expect(ok.saved).toEqual([SUB]);
  });
  it("tắt: gỡ ở trình duyệt rồi xoá endpoint đó ở server; chưa đăng ký ⇒ không gọi server", async () => {
    const d = deps();
    expect(await disablePush(d)).toBe("ok");
    expect(d.removed).toEqual([SUB.endpoint]);
    const none = deps({ unsubscribe: async () => null });
    await disablePush(none);
    expect(none.removed).toEqual([]);
  });
  it("isSubscribed: cần quyền granted + có đăng ký", async () => {
    expect(await isSubscribed(deps({ permission: () => "granted" }))).toBe(true);
    expect(await isSubscribed(deps({ permission: () => "default" }))).toBe(false);
    expect(
      await isSubscribed(deps({ permission: () => "granted", current: async () => null })),
    ).toBe(false);
  });
});
