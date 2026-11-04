// PK-FR-10 · TF1 · QueryClient dùng chung: không thử lại lỗi 4xx (403/404 là kết quả đúng), 5xx/mạng thử lại một lần.
// TF4: lỗi gói chung (403 PACK_* ⇒ nạp lại `/me`, 409 ⇒ toast) gắn ở QueryCache/MutationCache.
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "~/components/shared/toast";
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

export const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError: (err) => handlePackError(err, queryClient, fx) }),
  mutationCache: new MutationCache({ onError: (err) => handlePackError(err, queryClient, fx) }),
  defaultOptions: { queries: { staleTime: 30_000, retry: retryQuery } },
});
