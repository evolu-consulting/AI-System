// CR-148 · «tải dần»: khi cuối danh sách lọt vào khung nhìn thì tự gọi trang kế; nút «Xem thêm» luôn có (bàn phím, môi trường không có IntersectionObserver).
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

export function LoadSentinel({ loading, onMore }: { loading: boolean; onMore: () => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const more = useRef(onMore);
  more.current = onMore;
  useEffect(() => {
    const el = ref.current;
    if (!el || loading || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) more.current();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [loading]);
  return (
    <div ref={ref} className="p-2 text-center">
      <button type="button" disabled={loading} onClick={onMore} className="btn btn-sm">
        {loading ? t("contracts.messages.loadingMore") : t("contracts.messages.loadMore")}
      </button>
    </div>
  );
}
