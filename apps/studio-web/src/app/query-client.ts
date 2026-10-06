// HUB-FR-72 · QueryClient dùng chung: staleTime 30 s (plan-frontend §8); 4xx không thử lại (404/403 là kết quả đúng).
// H4a-R01 · mất quyền giữa phiên: query/mutation nào nhận 403 FORBIDDEN ⇒ xoá cache + báo `onForbidden` (SessionWatcher
// điều hướng `/forbidden`). Không import router ở đây — router → routes → guard → query-client sẽ thành vòng.
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

/** Lỗi có `status` HTTP (lớp ApiError của `lib/http` ở F2 thoả cấu trúc này). */
const httpStatus = (err: unknown): number =>
  typeof err === "object" && err !== null && "status" in err ? Number(err.status) : 0;

/** 403 mã FORBIDDEN = tài khoản không còn role vào Studio (khác 403 nghiệp vụ mã riêng). */
export const isForbidden = (err: unknown): boolean =>
  httpStatus(err) === 403 && (err as { code?: unknown }).code === "FORBIDDEN";

const forbiddenListeners = new Set<() => void>();

/** Đăng ký nghe "mất quyền"; trả hàm huỷ đăng ký. */
export function onForbidden(fn: () => void): () => void {
  forbiddenListeners.add(fn);
  return () => {
    forbiddenListeners.delete(fn);
  };
}

export function createQueryClient(): QueryClient {
  const handle = (err: unknown) => {
    if (!isForbidden(err)) return;
    client.clear();
    for (const fn of forbiddenListeners) fn();
  };
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: handle }),
    mutationCache: new MutationCache({ onError: handle }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failures, err) =>
          failures < 1 && !(httpStatus(err) >= 400 && httpStatus(err) < 500),
      },
    },
  });
  return client;
}

export const queryClient = createQueryClient();
