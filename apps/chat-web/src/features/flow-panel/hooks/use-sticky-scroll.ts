// CHAT-AC-14 · luồng khung flow: bám đáy khi nội dung lớn lên (stream, tin mới); gần đỉnh → tải trang E11 cũ hơn và giữ vị trí.
import { useEffect, useRef } from "react";
import { isNearBottom } from "~/features/thread/lib/thread-logic";
import { LOAD_OLDER_PX } from "../lib/flow-panel-logic";

export function useStickyScroll(older: { has: boolean; load(): void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const lastHeight = useRef(0);
  const loadingOlder = useRef(false);

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

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stick.current = isNearBottom(el);
    if (el.scrollTop < LOAD_OLDER_PX && older.has && !loadingOlder.current) {
      loadingOlder.current = true;
      lastHeight.current = el.scrollHeight;
      older.load();
    }
  };
  return { scrollRef, contentRef, onScroll };
}
