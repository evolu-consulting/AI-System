// CHAT-AC-07 · tự cuộn theo stream khi người dùng đang ở đáy; cuộn lên (> 80px) → giữ vị trí, hiện "↓ Tin mới".
// CR-051: gần đỉnh → tải trang flow cũ hơn (`older`), giữ nguyên vị trí đang xem khi nội dung chèn lên trên.
import { useCallback, useEffect, useRef, useState } from "react";
import { LOAD_OLDER_PX } from "~/features/flow-panel/lib/flow-panel-logic";
import { isNearBottom } from "../lib/thread-logic";

type Older = { has: boolean; load(): void };

export function useAutoscroll(streaming: boolean, older?: Older) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const loadingOlder = useRef(false);
  const lastHeight = useRef(0);
  const olderRef = useRef(older);
  olderRef.current = older;
  const [away, setAway] = useState(false);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const near = isNearBottom(el);
    stick.current = near;
    setAway(!near);
    const o = olderRef.current;
    if (o?.has && el.scrollTop < LOAD_OLDER_PX && !loadingOlder.current) {
      loadingOlder.current = true;
      lastHeight.current = el.scrollHeight;
      o.load();
    }
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
      if (!el) return;
      if (stick.current) el.scrollTop = el.scrollHeight;
      else if (loadingOlder.current) el.scrollTop += el.scrollHeight - lastHeight.current;
      loadingOlder.current = false;
      lastHeight.current = el.scrollHeight;
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, []);

  return { scrollRef, contentRef, onScroll, scrollToBottom, showNew: away && streaming };
}
