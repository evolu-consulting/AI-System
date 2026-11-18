// CR-186 · khối «ô đăng bài + thanh tab» của Bảng tin dính đầu vùng cuộn: biết khi nào người dùng đã cuộn qua điểm gốc (`stuck`)
// bằng một «mốc» 1px đặt ngay trước khối (IntersectionObserver, không nghe sự kiện cuộn) + biết màn hẹp (điện thoại ≤ 640px).
// Hẹp + đã cuộn ⇒ ô đăng thu thành MỘT dòng «Viết bài…» (`composerCompact`).
import { useEffect, useRef, useState } from "react";

export const NARROW_QUERY = "(max-width: 640px)";

/** Ô đăng bài thu thành một dòng khi: màn hẹp và khối đã dính (người dùng đã cuộn xuống). */
export const composerCompact = (stuck: boolean, narrow: boolean): boolean => stuck && narrow;

export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof matchMedia === "function" && matchMedia(NARROW_QUERY).matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const m = matchMedia(NARROW_QUERY);
    const on = () => setNarrow(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return narrow;
}

export function useStuck() {
  const sentinel = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => e && setStuck(!e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  /** Cuộn về mốc (đầu khối) — để ô đăng mở đầy đủ hiện trọn. */
  const toTop = () => sentinel.current?.scrollIntoView({ block: "start" });
  return { sentinel, stuck, toTop };
}
