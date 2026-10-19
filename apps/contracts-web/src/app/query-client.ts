// PK-FR-10 · TF1 · QueryClient dùng chung: không thử lại lỗi 4xx (403/404 là kết quả đúng), 5xx/mạng thử lại một lần.
import { QueryClient } from "@tanstack/react-query";

/** Lỗi API mang `status` (lớp lỗi HTTP đầy đủ do web-kit ở TF3). */
export const isClientError = (err: unknown): boolean => {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === "number" && status > 0 && status < 500;
};

export const retryQuery = (failures: number, err: unknown): boolean =>
  failures < 1 && !isClientError(err);

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: retryQuery } },
});
