// N3-FR-09 · dữ liệu chuông: danh sách + số chưa đọc + tùy chọn kênh. Lỗi mạng/5xx ⇒ chuông rỗng (không toast: đây là phụ trợ,
// không được làm phiền); 401 do web-kit xử lý (refresh/đăng xuất). Làm tươi: khi cửa sổ lấy lại focus, khi mở chuông, mỗi 60 s.
import type { NotificationList, NotifyPrefs } from "@ai/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchNotifications, fetchPrefs, markRead, savePrefs } from "../api";

export const NOTIFY_KEY = ["notifications"] as const;
const PREFS_KEY = ["notifications", "prefs"] as const;
const REFRESH_MS = 60_000;

export type Bell = {
  items: NotificationList["items"];
  unread: number;
  prefs: NotifyPrefs | null;
  refresh: () => void;
  readOne: (id: string) => void;
  readAll: () => void;
  setPrefs: (p: NotifyPrefs) => void;
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
  const prefs = useQuery({
    queryKey: PREFS_KEY,
    queryFn: ({ signal }) => fetchPrefs(signal),
    enabled,
    retry: false,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: NOTIFY_KEY, exact: true });
  const read = useMutation({ mutationFn: markRead, onSuccess: invalidate });
  // Lạc quan: ô chọn đổi ngay; lỗi ⇒ nạp lại giá trị thật từ server.
  const save = useMutation({
    mutationFn: savePrefs,
    onMutate: (p) => qc.setQueryData(PREFS_KEY, p),
    onError: () => qc.invalidateQueries({ queryKey: PREFS_KEY }),
  });
  return {
    items: list.data?.items ?? [],
    unread: list.data?.unread ?? 0,
    prefs: prefs.data ?? null,
    refresh: () => void invalidate(),
    readOne: (id) => read.mutate({ ids: [id] }),
    readAll: () => read.mutate({ all: true }),
    setPrefs: (p) => save.mutate(p),
  };
}
