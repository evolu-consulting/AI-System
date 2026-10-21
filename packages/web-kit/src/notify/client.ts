// gap-c · #12/#13/#11 · gọi `/notifications*` của hub-api (cùng origin). Dùng chung cho chuông + trang "Tất cả thông báo" của 4 web.
// Admin-web/studio-web có client HTTP + phiên RIÊNG (kit không biết token của họ) ⇒ nhận `transport`; chat/contracts dùng mặc định
// (`http.ts` của kit). Chỉ kiểu (`import type`) từ contract — không kéo zod vào bundle.
import type {
  MarkReadBody,
  MarkReadResult,
  NotificationList,
  NotifyPrefs,
  NotifyPrefsView,
  PushKey,
  PushSubscriptionBody,
  PushTestResult,
} from "@ai/contracts";
import { api, type RequestOptions } from "../http";

export type { NotificationList, NotifyPrefs, NotifyPrefsView };
export type NotificationItem = NotificationList["items"][number];

/** Cùng hình `{ request }` của FeedbackFab: web nào có client riêng truyền `{ request: api }` của họ. */
export type NotifyTransport = {
  request: <T>(path: string, opts?: RequestOptions) => Promise<T>;
};
export const DEFAULT_TRANSPORT: NotifyTransport = { request: api };

export function notifyClient(t: NotifyTransport = DEFAULT_TRANSPORT) {
  const r = t.request;
  return {
    list: (o: { limit?: number; before?: number | null; signal?: AbortSignal } = {}) =>
      r<NotificationList>("/notifications", {
        query: { limit: o.limit ?? 20, before: o.before ?? undefined },
        signal: o.signal,
      }),
    markRead: (body: MarkReadBody) =>
      r<MarkReadResult>("/notifications/read", { method: "POST", body }),
    prefs: (signal?: AbortSignal) => r<NotifyPrefsView>("/notifications/prefs", { signal }),
    savePrefs: (body: NotifyPrefs) =>
      r<NotifyPrefsView>("/notifications/prefs", { method: "PUT", body }),
    pushKey: () => r<PushKey>("/notifications/push/key"),
    savePush: (body: PushSubscriptionBody) =>
      r<void>("/notifications/push/subscriptions", { method: "POST", body }),
    removePush: (endpoint: string) =>
      r<void>("/notifications/push/subscriptions", { method: "DELETE", body: { endpoint } }),
    pushTest: () => r<PushTestResult>("/notifications/push/test", { method: "POST" }),
  };
}
export type NotifyClient = ReturnType<typeof notifyClient>;
