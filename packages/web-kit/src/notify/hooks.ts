// gap-c #13/#11 · hook dữ liệu chuông + trang "Tất cả thông báo" + tùy chọn. Không phụ thuộc react-query (web-kit chỉ cần React):
// state cục bộ, huỷ lượt cũ khi unmount. Lỗi mạng ⇒ giữ dữ liệu cũ (chuông là phụ trợ, không báo lỗi ồn ào; 401 do `http.ts` lo).
import { useCallback, useEffect, useRef, useState } from "react";
import type { NotificationItem, NotifyClient, NotifyPrefs, NotifyPrefsView } from "./client";

const BELL_PAGE = 10;
const FEED_PAGE = 20;

/** Gộp trang kế vào danh sách, bỏ trùng theo id (làm tươi trong lúc đang cuộn không nhân đôi hàng). */
export function mergePage(
  cur: readonly NotificationItem[],
  next: readonly NotificationItem[],
): NotificationItem[] {
  const seen = new Set(cur.map((n) => n.id));
  return [...cur, ...next.filter((n) => !seen.has(n.id))];
}

/** Chuông: 10 mới nhất + số chưa đọc; làm tươi mỗi `pollMs`, khi lấy lại focus và khi gọi `refresh` (mở chuông). */
export function useBell(c: NotifyClient, pollMs = 60_000) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const alive = useRef(true);
  const refresh = useCallback(async () => {
    try {
      const r = await c.list({ limit: BELL_PAGE });
      if (!alive.current) return;
      setItems(r.items);
      setUnread(r.unread);
    } catch {
      // giữ dữ liệu cũ
    }
  }, [c]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const t = setInterval(() => void refresh(), pollMs);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      alive.current = false;
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh, pollMs]);
  const readOne = useCallback(
    async (id: string) => {
      setItems((a) => a.map((n) => (n.id === id ? { ...n, read: true } : n)));
      setUnread((u) => Math.max(0, u - 1));
      await c.markRead({ ids: [id] }).catch(() => undefined);
      void refresh();
    },
    [c, refresh],
  );
  const readAll = useCallback(async () => {
    setItems((a) => a.map((n) => ({ ...n, read: true })));
    setUnread(0);
    await c.markRead({ all: true }).catch(() => undefined);
    void refresh();
  }, [c, refresh]);
  return { items, unread, refresh, readOne, readAll };
}

/** Trang đầy đủ: phân trang theo con trỏ `next_before` (không offset). */
export function useFeed(c: NotifyClient) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const load = useCallback(
    async (before: number | null) => {
      setLoading(true);
      try {
        const r = await c.list({ limit: FEED_PAGE, before });
        setItems((cur) => (before === null ? r.items : mergePage(cur, r.items)));
        setNext(r.next_before);
        setUnread(r.unread);
        setError(false);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    },
    [c],
  );
  useEffect(() => void load(null), [load]);
  const readOne = useCallback(
    async (id: string) => {
      setItems((a) => a.map((n) => (n.id === id ? { ...n, read: true } : n)));
      setUnread((u) => Math.max(0, u - 1));
      await c.markRead({ ids: [id] }).catch(() => undefined);
    },
    [c],
  );
  const readAll = useCallback(async () => {
    setItems((a) => a.map((n) => ({ ...n, read: true })));
    setUnread(0);
    await c.markRead({ all: true }).catch(() => undefined);
  }, [c]);
  return {
    items,
    unread,
    loading,
    error,
    hasMore: next !== null,
    loadMore: () => (next === null ? Promise.resolve() : load(next)),
    reload: () => load(null),
    readOne,
    readAll,
  };
}

export function usePrefs(c: NotifyClient) {
  const [prefs, setPrefs] = useState<NotifyPrefsView | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    c.prefs()
      .then((p) => live && setPrefs(p))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [c]);
  /** Lưu một phần thay đổi; email/push luôn gửi kèm giá trị hiện tại. Lỗi ⇒ nạp lại giá trị thật. */
  const save = useCallback(
    async (cur: NotifyPrefsView, patch: Partial<NotifyPrefs>) => {
      const body: NotifyPrefs = { email: cur.email, push: cur.push, ...patch };
      try {
        setPrefs(await c.savePrefs(body));
        setError(false);
        return true;
      } catch {
        setError(true);
        c.prefs()
          .then(setPrefs)
          .catch(() => undefined);
        return false;
      }
    },
    [c],
  );
  return { prefs, error, save };
}
