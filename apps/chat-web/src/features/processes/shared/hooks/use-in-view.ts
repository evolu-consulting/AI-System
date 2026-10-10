// CR-056 · P-a plan-frontend-thread §2: bật `enabled` của query khi phần tử vào màn hình (khối ngoài màn hình không fetch).
import { useCallback, useEffect, useRef, useState } from "react";

export function useInView<T extends Element>(): { ref: (el: T | null) => void; inView: boolean } {
  const [inView, setInView] = useState(typeof IntersectionObserver === "undefined");
  const obs = useRef<IntersectionObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    obs.current?.disconnect();
    obs.current = null;
    if (!el || typeof IntersectionObserver === "undefined") return;
    obs.current = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          obs.current?.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    obs.current.observe(el);
  }, []);
  useEffect(() => () => obs.current?.disconnect(), []);
  return { ref, inView };
}
