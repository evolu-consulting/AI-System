// C1 FE · QueryClient dùng chung: không thử lại lỗi 4xx (404/403 là kết quả đúng), 5xx/mạng thử lại một lần.
import { QueryClient } from "@tanstack/react-query";

/** Lỗi HTTP có `status` (F3 thay bằng `ApiError` của `~/lib/http`). */
const isClientError = (err: unknown): boolean => {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === "number" && status > 0 && status < 500;
};

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failures, err) => failures < 1 && !isClientError(err),
    },
  },
});
