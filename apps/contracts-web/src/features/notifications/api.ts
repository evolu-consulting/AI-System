// N3-FR-09 · gọi `/notifications*` của hub-api (proxy cùng origin, D-18) — Bearer + refresh 1 lần do web-kit lo.
import type { MarkReadBody, MarkReadResult, NotificationList } from "@ai/contracts";
import { api } from "@ai/web-kit/http";

const PAGE = 20;

export const fetchNotifications = (signal?: AbortSignal): Promise<NotificationList> =>
  api<NotificationList>("/notifications", { query: { limit: PAGE }, signal });

export const markRead = (body: MarkReadBody): Promise<MarkReadResult> =>
  api<MarkReadResult>("/notifications/read", { method: "POST", body });
