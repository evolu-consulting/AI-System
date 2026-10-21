// N3-FR-09 · dữ liệu chuông: danh sách + số chưa đọc + tùy chọn kênh. Lỗi mạng/5xx ⇒ chuông rỗng (không toast: đây là phụ trợ,
// không được làm phiền); 401 do web-kit xử lý (refresh/đăng xuất). Làm tươi: khi cửa sổ lấy lại focus, khi mở chuông, mỗi 60 s.
import type { NotificationList } from "@ai/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchNotifications, markRead } from "../api";

export const NOTIFY_KEY = ["notifications"] as const;
const REFRESH_MS = 60_000;

export type Bell = {
  items: NotificationList["items"];
  unread: number;
  refresh: () => void;
  readOne: (id: string) => void;
  readAll: () => void;
};

export function useBell(enabled = true): Bell {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: NOTIFY_KEY,
    queryFn: ({ signal }) => fetchNotifications(signal),
    enabled,
    retry: false,
    refetchInterval: REFRESH_MS,
    refetchOnWindowFocus: true,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: NOTIFY_KEY, exact: true });
  const read = useMutation({ mutationFn: markRead, onSuccess: invalidate });
  return {
    items: list.data?.items ?? [],
    unread: list.data?.unread ?? 0,
    refresh: () => void invalidate(),
    readOne: (id) => read.mutate({ ids: [id] }),
    readAll: () => read.mutate({ all: true }),
  };
}
