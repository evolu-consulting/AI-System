// ADM-NFR-06 · QueryClient dùng chung: không thử lại lỗi 4xx (404/403 là kết quả đúng), 5xx/mạng thử lại một lần.
import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/http";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failures, err) =>
        failures < 1 && !(err instanceof ApiError && err.status < 500 && err.status > 0),
    },
  },
});
