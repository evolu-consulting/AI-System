// CHAT-AC-07 · tự cuộn theo stream khi người dùng đang ở đáy; cuộn lên (> 80px) → giữ vị trí, hiện "↓ Tin mới".
import { useCallback, useEffect, useRef, useState } from "react";
import { isNearBottom } from "../lib/thread-logic";

export function useAutoscroll(streaming: boolean) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [away, setAway] = useState(false);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const near = isNearBottom(el);
    stick.current = near;
    setAway(!near);
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    stick.current = true;
    setAway(false);
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // Nội dung đổi cỡ (delta mới, tải xong, khối mới) → bám đáy nếu đang bám.
  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const el = scrollRef.current;
      if (el && stick.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, []);

  return { scrollRef, contentRef, onScroll, scrollToBottom, showNew: away && streaming };
}
