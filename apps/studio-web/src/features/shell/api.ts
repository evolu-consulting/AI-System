// HUB-FR-72 · H4a-R02 · `GET /studio/api/me`: kiểm role sau đăng nhập (403 ⇒ /forbidden) + badge `hub config vN`.
import type { Me } from "@ai/contracts/studio";
import { queryOptions } from "@tanstack/react-query";
import { api } from "#/lib/http";

export const meQuery = queryOptions({
  queryKey: ["studio", "me"] as const,
  queryFn: ({ signal }) => api<Me>("/studio/api/me", { signal }),
});
