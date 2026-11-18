// CR-182 · kiểu xem «Xoè quạt»: xấp tối đa 5 trang, mỗi trang dưới chỉ lộ một dải 40px ở mép phải hoặc mép dưới.
// Hàm thuần, không DOM. Bản mẫu: prototype.html dòng 577–598 (dựng), 637–648 (visible/partsOf — partsOf ở geometry.ts).
import { SIGN_SEAM_PAGES_MAX } from "@ai/contracts/pack-contracts";
import type { Rect, StagePage } from "./geometry";
import { layoutPages, type PageSize, STAGE_PAD } from "./layout";
import type { SignItem } from "./sign-items";

export const FAN_PX = 40;
export const FAN_GROUP = SIGN_SEAM_PAGES_MAX;
const FAN_MAX_W_RIGHT = 460;
const FAN_MAX_W_BOTTOM = 400;
const MIN_W = 120;

export type ViewMode = "page" | "fan";
export type FanEdge = "right" | "bottom";
export type StageView = { mode: ViewMode; lien: boolean; edge: FanEdge; group: number };
export const DEFAULT_VIEW: StageView = { mode: "page", lien: false, edge: "right", group: 0 };

export type ViewLayout = { pages: StagePage[]; width: number; height: number; fan: boolean };

/** Mỗi chữ ký thuộc một kiểu xem: «page» hoặc «fan-<mép>-<nhóm>». «Liền mép» không đổi khoá. */
export const viewKey = (v: StageView) => (v.mode === "page" ? "page" : `fan-${v.edge}-${v.group}`);

/** Sửa/kéo được khi: của mình, chưa ký, và đúng kiểu xem đã đặt nó. */
export const editableIn = (i: SignItem, key: string) =>
  i.status === "editable" && (i.view ?? "page") === key;

export const groupCount = (total: number) => Math.max(1, Math.ceil(total / FAN_GROUP));
export const clampGroup = (g: number, total: number) =>
  Math.max(0, Math.min(g, groupCount(total) - 1));

/** Trang (0-based, gồm hai đầu) của nhóm: «Trang 1–5» ⇒ {from:0,to:4}. */
export function groupRange(total: number, group: number) {
  const from = clampGroup(group, total) * FAN_GROUP;
  return { from, to: Math.min(total, from + FAN_GROUP) - 1 };
}

export function layoutFan(
  sizes: PageSize[],
  containerWidth: number,
  edge: FanEdge,
  group: number,
): ViewLayout {
  const { from, to } = groupRange(sizes.length, group);
  const list = sizes.slice(from, to + 1);
  const steps = Math.max(0, list.length - 1);
  const avail = Math.max(MIN_W, containerWidth - STAGE_PAD * 2);
  const bottom = edge === "bottom";
  const width = Math.max(
    MIN_W,
    bottom ? Math.min(FAN_MAX_W_BOTTOM, avail) : Math.min(FAN_MAX_W_RIGHT, avail - FAN_PX * steps),
  );
  const block = width + (bottom ? 0 : FAN_PX * steps);
  const left0 = Math.max(0, (containerWidth - block) / 2);
  let bottomMost = STAGE_PAD;
  const pages = list.map((s, i): StagePage => {
    const height = (width * s.ptHeight) / s.ptWidth;
    const left = left0 + (bottom ? 0 : i * FAN_PX);
    const top = STAGE_PAD + (bottom ? i * FAN_PX : 0);
    bottomMost = Math.max(bottomMost, top + height);
    const visible: Rect | undefined =
      i === 0
        ? undefined
        : bottom
          ? { l: left, t: top + height - FAN_PX, w: width, h: FAN_PX }
          : { l: left + width - FAN_PX, t: top, w: FAN_PX, h: height };
    return {
      index: from + i,
      left,
      top,
      width,
      height,
      ptWidth: s.ptWidth,
      ptHeight: s.ptHeight,
      visible,
    };
  });
  return { pages, width: containerWidth, height: bottomMost + STAGE_PAD, fan: true };
}

export function layoutView(sizes: PageSize[], containerWidth: number, v: StageView): ViewLayout {
  if (v.mode === "fan") return layoutFan(sizes, containerWidth, v.edge, v.group);
  const l = layoutPages(sizes, containerWidth, v.lien ? 0 : undefined);
  return { ...l, fan: false };
}

/** Điện thoại (≤ 640px) chỉ có «Từng trang». Chỉ là kiểu xem HIỆU LỰC: kiểu người dùng đã chọn giữ nguyên, rộng lại thì trở về. */
export const effectiveView = (chosen: StageView, phone: boolean): StageView =>
  phone && chosen.mode === "fan" ? { ...chosen, mode: "page" } : chosen;
