// C1 FE · QueryClient dùng chung: không thử lại lỗi 4xx (404/403 là kết quả đúng), 5xx/mạng thử lại một lần.
// Phiên bị xoá (đăng xuất / refresh hỏng) → xoá cache để không lộ dữ liệu người trước.
import { QueryClient } from "@tanstack/react-query";
import { session } from "~/lib/auth/session";
import { ApiError } from "~/lib/http";

const isClientError = (err: unknown): boolean =>
  err instanceof ApiError && err.status > 0 && err.status < 500;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failures, err) => failures < 1 && !isClientError(err),
    },
  },
});

session.on("cleared", () => queryClient.clear());
session.on("expired", () => queryClient.clear());
