// CR-181 · thao tác trên ô chữ ký: nhích, đổi cỡ giữ tỉ lệ, chép sang mọi trang, nhãn. Bản mẫu dòng 659–672, 706.
import type { SignPart } from "@ai/contracts/pack-contracts";
import type { Rect, StagePage } from "./geometry";

export const NUDGE_PX = 4;
export const MIN_SIGN_W_PX = 30;

export type ArrowKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";
export type Corner = "nw" | "ne" | "sw" | "se";

const ARROW: Record<ArrowKey, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

export function nudge(r: Rect, key: ArrowKey, step = NUDGE_PX): Rect {
  const [dx, dy] = ARROW[key];
  return { ...r, l: r.l + dx * step, t: r.t + dy * step };
}

/** Kéo góc, giữ tỉ lệ `aspect` (rộng:cao), neo ở góc đối diện. `start` = rect lúc bắt đầu kéo; chỉ dùng dx như bản mẫu. */
export function resizeKeepAspect(
  start: Rect,
  corner: Corner,
  dx: number,
  aspect: number,
  minW = MIN_SIGN_W_PX,
): Rect {
  const east = corner.includes("e");
  const north = corner.includes("n");
  const w = Math.max(minW, start.w + (east ? 1 : -1) * dx);
  const h = w / aspect;
  return {
    l: east ? start.l : start.l + start.w - w,
    t: north ? start.t + start.h - h : start.t,
    w,
    h,
  };
}

export type PageRect = { page: number; rect: Rect };

/** «Chép sang mọi trang» (Q11): cùng vị trí tương đối, tâm giữ nguyên, cỡ × scale; bỏ trang nguồn. */
export function copyToAllPages(
  r: Rect,
  srcPage: number,
  pages: StagePage[],
  scale: number,
): PageRect[] {
  const src = pages.find((p) => p.index === srcPage);
  if (!src) return [];
  const w = r.w * scale;
  const h = r.h * scale;
  const out: PageRect[] = [];
  for (const p of pages) {
    if (p.index === srcPage) continue;
    const cx = p.left + (r.l - src.left) + r.w / 2;
    const cy = p.top + (r.t - src.top) + r.h / 2;
    out.push({ page: p.index, rect: { l: cx - w / 2, t: cy - h / 2, w, h } });
  }
  return out;
}

/** Nhãn VI trong bản mẫu (i18n hoá ở lớp component). */
export function labelFor(parts: Pick<SignPart, "page">[]): string {
  if (parts.length > 1)
    return `Giáp lai ${parts.length} trang: ${parts.map((p) => p.page + 1).join(", ")}`;
  const p = parts[0];
  return p ? `Trang ${p.page + 1}` : "Kéo vào trang";
}

/** Giữ rect trong sân khấu; lớn hơn sân khấu thì ghim về 0. */
export function clampToStage(r: Rect, stage: { width: number; height: number }): Rect {
  const l = Math.max(0, Math.min(r.l, stage.width - r.w));
  const t = Math.max(0, Math.min(r.t, stage.height - r.h));
  return { ...r, l, t };
}
