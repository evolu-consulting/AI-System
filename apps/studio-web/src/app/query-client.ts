// HUB-FR-72 · QueryClient dùng chung: staleTime 30 s (plan-frontend §8); 4xx không thử lại (404/403 là kết quả đúng).
import { QueryClient } from "@tanstack/react-query";

/** Lỗi có `status` HTTP (lớp ApiError của `lib/http` ở F2 thoả cấu trúc này). */
const httpStatus = (err: unknown): number =>
  typeof err === "object" && err !== null && "status" in err ? Number(err.status) : 0;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failures, err) => failures < 1 && !(httpStatus(err) >= 400 && httpStatus(err) < 500),
    },
  },
});
