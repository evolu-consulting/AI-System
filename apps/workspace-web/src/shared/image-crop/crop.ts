// CR-192 · hộp cắt ảnh hồ sơ (thuần, không DOM): toạ độ vùng cắt + phóng 1–3×, rồi vẽ + mã hoá xuống đúng cỡ/dung lượng.
// Đại diện 400×400 ≤ 150 KB; bìa 1200×400 (3:1) ≤ 400 KB. Quá dung lượng ⇒ giảm chất lượng, vẫn quá ⇒ thu nhỏ dần; không từ chối ảnh lớn.
import { AVATAR_MAX_BYTES } from "@ai/contracts/people";
import { type AvatarCanvas, encodeImage } from "./avatar-encode";
import type { ImageKind } from "./image";

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 3;
export const COVER_MAX_BYTES = 400 * 1024;

export type CropSpec = { aspect: number; outW: number; outH: number; maxBytes: number };
export const CROP: Record<ImageKind, CropSpec> = {
  avatar: { aspect: 1, outW: 400, outH: 400, maxBytes: AVATAR_MAX_BYTES },
  cover: { aspect: 3, outW: 1200, outH: 400, maxBytes: COVER_MAX_BYTES },
};

export type Rect = { sx: number; sy: number; sw: number; sh: number };
export const clampZoom = (z: number): number =>
  Number.isFinite(z) ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) : ZOOM_MIN;

/** Vùng cắt (px ảnh gốc): khung tỉ lệ `aspect` lớn nhất vừa ảnh, chia cho `zoom`, tâm (cx,cy) bị kẹp để không ra ngoài ảnh. */
export function cropRect(
  size: { w: number; h: number },
  aspect: number,
  zoom: number,
  center: { cx: number; cy: number },
): Rect {
  const { w, h } = size;
  const { cx, cy } = center;
  const base = w / h >= aspect ? { w: h * aspect, h } : { w, h: w / aspect };
  const z = clampZoom(zoom);
  const sw = base.w / z;
  const sh = base.h / z;
  const sx = Math.min(w - sw, Math.max(0, cx - sw / 2));
  const sy = Math.min(h - sh, Math.max(0, cy - sh / 2));
  return { sx, sy, sw, sh };
}

/** Kéo `dx,dy` px màn hình trên khung rộng `viewW` px ⇒ tâm mới (ảnh đi theo ngón tay: tâm lùi ngược chiều). */
export function panCenter(
  r: Rect,
  viewW: number,
  dx: number,
  dy: number,
): { cx: number; cy: number } {
  const k = viewW > 0 ? r.sw / viewW : 0;
  return { cx: r.sx + r.sw / 2 - dx * k, cy: r.sy + r.sh / 2 - dy * k };
}

export type CropCanvas = AvatarCanvas & {
  getContext(id: "2d"): {
    drawImage(
      src: never,
      sx: number,
      sy: number,
      sw: number,
      sh: number,
      dx: number,
      dy: number,
      dw: number,
      dh: number,
    ): void;
  } | null;
};

/** Cổng ra ngoài của bước vẽ: tạo canvas `w×h` + đọc blob thành data URL. */
export type CropIO = {
  makeCanvas: (w: number, h: number) => CropCanvas;
  readBlob: (b: Blob) => Promise<string>;
};

/** Vẽ vùng cắt ra canvas `w×h` rồi mã hoá ≤ `maxBytes`; không đạt ⇒ thu nhỏ 80 % mỗi vòng (tối đa 5 vòng). */
export async function cropToDataUrl(
  draw: unknown,
  rect: Rect,
  spec: CropSpec,
  io: CropIO,
): Promise<string> {
  const { makeCanvas, readBlob } = io;
  let last: unknown = new Error("crop: không mã hoá được");
  for (let i = 0; i < 5; i++) {
    const k = 0.8 ** i;
    const w = Math.max(1, Math.round(spec.outW * k));
    const h = Math.max(1, Math.round(spec.outH * k));
    const cv = makeCanvas(w, h);
    cv.getContext("2d")?.drawImage(draw as never, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, w, h);
    try {
      return await encodeImage(cv, readBlob, spec.maxBytes);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}
