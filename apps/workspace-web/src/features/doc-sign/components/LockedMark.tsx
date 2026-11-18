// CR-182 · chữ ký đặt ở kiểu xem KHÁC kiểu xem hiện tại: vẫn hiện, không kéo được. Vẽ đúng các lát đã cắt (`parts`),
// chỉ phần đang lộ ở bố cục hiện tại, để giáp lai không bị cắt sai.
import { useTranslation } from "react-i18next";
import type { Rect, StagePage } from "../lib/geometry";
import type { SignItem } from "../lib/sign-items";
import { markLabel } from "./MarkBox";

const sliceOf = (q: SignItem["parts"][number], p: StagePage): Rect => {
  const k = p.width / p.ptWidth;
  return {
    l: p.left + q.cx * k,
    t: p.top + (p.ptHeight - q.cy - q.ch) * k,
    w: q.cw * k,
    h: q.ch * k,
  };
};
const meet = (a: Rect, b: Rect): Rect | null => {
  const l = Math.max(a.l, b.l);
  const t = Math.max(a.t, b.t);
  const r = Math.min(a.l + a.w, b.l + b.w);
  const bt = Math.min(a.t + a.h, b.t + b.h);
  return r - l < 1 || bt - t < 1 ? null : { l, t, w: r - l, h: bt - t };
};

export function LockedMark({ item, pages }: { item: SignItem; pages: StagePage[] }) {
  const { t } = useTranslation();
  const where = item.parts.flatMap((q) => {
    const p = pages.find((x) => x.index === q.page);
    return p ? [{ q, p }] : [];
  });
  const head = where[0];
  if (!head || !item.imageUrl) return null;
  const k = head.p.width / head.p.ptWidth;
  const full: Rect = {
    l: head.p.left + head.q.x * k,
    t: head.p.top + (head.p.ptHeight - head.q.y - head.q.h) * k,
    w: head.q.w * k,
    h: head.q.h * k,
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: nhóm các lát của một chữ ký, không phải fieldset
    <div
      role="group"
      aria-label={t("contracts.docsign.markAria", { label: markLabel(t, item) })}
      data-testid="sign-mark-locked"
      className="pointer-events-none absolute left-0 top-0 z-10"
    >
      {where.map(({ q, p }) => {
        const s = meet(
          sliceOf(q, p),
          p.visible ?? { l: p.left, t: p.top, w: p.width, h: p.height },
        );
        if (!s) return null;
        return (
          <div
            key={q.page}
            className="absolute overflow-hidden"
            style={{ left: s.l, top: s.t, width: s.w, height: s.h }}
          >
            <img
              src={item.imageUrl}
              alt=""
              draggable={false}
              className="absolute max-w-none object-contain"
              style={{ left: full.l - s.l, top: full.t - s.t, width: full.w, height: full.h }}
            />
          </div>
        );
      })}
    </div>
  );
}
