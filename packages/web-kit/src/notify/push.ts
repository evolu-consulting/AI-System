// gap-c #12 · web push thật phía trình duyệt: service worker + PushManager (khoá VAPID từ `/notifications/push/key`), lưu/xoá đăng ký
// qua `/notifications/push/subscriptions`. CHỈ chạy khi người dùng chủ động bật (không tự xin quyền lúc tải trang) và chỉ trong ngữ
// cảnh an toàn (HTTPS hoặc localhost). Logic điều phối nhận `PushDeps` để test không cần trình duyệt.

export type PushResult = "ok" | "unsupported" | "insecure" | "denied" | "no_key" | "error";

/** `PushSubscription.toJSON()` đủ dùng cho server. */
export type SubJson = { endpoint?: string; keys?: { p256dh?: string; auth?: string } };

export type PushDeps = {
  secure: boolean;
  supported: boolean;
  swUrl: string;
  permission(): NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
  vapidKey(): Promise<string | null>;
  /** Đăng ký (hoặc lấy lại) service worker rồi `pushManager.subscribe`; trả JSON đăng ký. */
  subscribe(swUrl: string, key: Uint8Array): Promise<SubJson>;
  /** Gỡ đăng ký của trình duyệt; trả endpoint đã gỡ (null = chưa có). */
  unsubscribe(swUrl: string): Promise<string | null>;
  current(swUrl: string): Promise<SubJson | null>;
  save(body: { endpoint: string; keys: { p256dh: string; auth: string } }): Promise<void>;
  remove(endpoint: string): Promise<void>;
};

/** Khoá VAPID công khai (base64url) ⇒ Uint8Array cho `applicationServerKey`. */
export function urlBase64ToUint8Array(b64: string): Uint8Array {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Hợp lệ gửi lên server (endpoint https + hai khoá); thiếu ⇒ null. */
export function subscriptionBody(
  s: SubJson | null,
): { endpoint: string; keys: { p256dh: string; auth: string } } | null {
  const p256dh = s?.keys?.p256dh;
  const auth = s?.keys?.auth;
  if (!s?.endpoint?.startsWith("https://") || !p256dh || !auth) return null;
  return { endpoint: s.endpoint, keys: { p256dh, auth } };
}

/** Bật thông báo đẩy: xin quyền (do người dùng bấm) → lấy khoá → đăng ký → lưu server. */
export async function enablePush(d: PushDeps): Promise<PushResult> {
  if (!d.secure) return "insecure";
  if (!d.supported) return "unsupported";
  try {
    const perm = d.permission() === "default" ? await d.requestPermission() : d.permission();
    if (perm !== "granted") return "denied";
    const key = await d.vapidKey();
    if (!key) return "no_key";
    const body = subscriptionBody(await d.subscribe(d.swUrl, urlBase64ToUint8Array(key)));
    if (!body) return "error";
    await d.save(body);
    return "ok";
  } catch {
    return "error";
  }
}

/** Tắt: gỡ đăng ký trình duyệt rồi xoá ở server (lỗi server không giữ đăng ký mồ côi ở trình duyệt). */
export async function disablePush(d: PushDeps): Promise<PushResult> {
  if (!d.supported) return "ok";
  try {
    const endpoint = await d.unsubscribe(d.swUrl);
    if (endpoint) await d.remove(endpoint);
    return "ok";
  } catch {
    return "error";
  }
}

/** Trình duyệt này đã có đăng ký push hiệu lực cho app? (hiện nút "Gửi thử"). */
export async function isSubscribed(d: PushDeps): Promise<boolean> {
  if (!d.secure || !d.supported || d.permission() !== "granted") return false;
  try {
    return (await d.current(d.swUrl)) !== null;
  } catch {
    return false;
  }
}

/** Phụ thuộc thật của trình duyệt. `swUrl` mặc định `/push-sw.js` (studio: `/studio/push-sw.js`). */
export function browserPushDeps(
  api: {
    vapidKey: () => Promise<string | null>;
    save: PushDeps["save"];
    remove: PushDeps["remove"];
  },
  swUrl = "/push-sw.js",
): PushDeps {
  const w = typeof window === "undefined" ? undefined : window;
  const secure = w?.isSecureContext === true;
  const supported =
    w !== undefined && "serviceWorker" in navigator && "PushManager" in w && "Notification" in w;
  const reg = async (url: string) => {
    await navigator.serviceWorker.register(url);
    return navigator.serviceWorker.ready;
  };
  return {
    secure,
    supported,
    swUrl,
    permission: () => Notification.permission,
    requestPermission: () => Notification.requestPermission(),
    vapidKey: api.vapidKey,
    subscribe: async (url, key) => {
      const r = await reg(url);
      const existing = await r.pushManager.getSubscription();
      const sub =
        existing ??
        (await r.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key as BufferSource,
        }));
      return sub.toJSON() as SubJson;
    },
    unsubscribe: async (url) => {
      const r = await navigator.serviceWorker.getRegistration(url);
      const sub = await r?.pushManager.getSubscription();
      if (!sub) return null;
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      return endpoint;
    },
    current: async (url) => {
      const r = await navigator.serviceWorker.getRegistration(url);
      const sub = await r?.pushManager.getSubscription();
      return sub ? (sub.toJSON() as SubJson) : null;
    },
    save: api.save,
    remove: api.remove,
  };
}
