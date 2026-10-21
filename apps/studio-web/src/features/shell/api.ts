// HUB-FR-72 · H4a-R02 · `GET /studio/api/me`: kiểm role sau đăng nhập (403 ⇒ /forbidden) + badge `hub config vN`.
import { MY_APPS_PATH, type MyAppsResponse, type SsoCodeResponse } from "@ai/contracts";
import type { Me } from "@ai/contracts/studio";
import { queryOptions } from "@tanstack/react-query";
import { api } from "#/lib/http";

export const meQuery = queryOptions({
  queryKey: ["studio", "me"] as const,
  queryFn: ({ signal }) => api<Me>("/studio/api/me", { signal }),
});

/** app-catalog · app người dùng được mở (switcher dùng chung) — `/auth/*` đã được proxy tới admin-api. */
export const fetchMyApps = () => api<MyAppsResponse>(MY_APPS_PATH).then((r) => r.items);

/** app-catalog · mã SSO một lần + URL đích do admin-api lấy từ catalog. */
export const requestSsoGrant = (app: string) =>
  api<SsoCodeResponse>("/auth/sso/code", { method: "POST", body: { app } });
