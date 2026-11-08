// PK-FR-10 · TF1 · QueryClient dùng chung: không thử lại lỗi 4xx (403/404 là kết quả đúng), 5xx/mạng thử lại một lần.
// TF4: lỗi gói chung (403 PACK_* ⇒ nạp lại `/me`, 409 ⇒ toast) gắn ở QueryCache/MutationCache.

import { toast } from "@ai/web-kit/ui/toast";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { handlePackError } from "~/features/pack-state/lib/query-errors";
import { i18n } from "./i18n";

/** Lỗi API mang `status` (ApiError của web-kit). */
export const isClientError = (err: unknown): boolean => {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === "number" && status > 0 && status < 500;
};

export const retryQuery = (failures: number, err: unknown): boolean =>
  failures < 1 && !isClientError(err);

const fx = { conflict: () => toast(i18n.t("contracts.errors.conflict"), "late") };

/** CR-118: 403 ở bất kỳ API ⇒ gói có thể vừa tắt ⇒ tải lại cờ (`/pack/me`, 304 rẻ) rồi xử lý lỗi gói như cũ. */
const onError = (err: unknown) => {
  // Nạp động: OpenFeature ra khỏi bundle đầu (chunk của vùng đã đăng nhập).
  if ((err as { status?: unknown } | null)?.status === 403) {
    void import("~/platform/features").then((m) => m.reportForbidden());
  }
  handlePackError(err, queryClient, fx);
};

export const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: { queries: { staleTime: 30_000, retry: retryQuery } },
});
