// CR-147b/CR-192 · giải mã ảnh người chọn và xuất data URL sau khi cắt. Cắt + thu nhỏ + mã hoá (400×400 ≤ 150 KB / 1200×400 ≤ 400 KB) ở `domain/crop.ts`.
import { CROP, cropToDataUrl, type Rect } from "./crop";
import type { ImageKind } from "./image";

const read = (f: Blob): Promise<string> =>
  new Promise((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => no(new Error("read"));
    r.readAsDataURL(f);
  });

export type Source = {
  width: number;
  height: number;
  draw: CanvasImageSource;
  release: () => void;
};

/** Giải mã ảnh: `createImageBitmap` trước; không có/lỗi ⇒ dự phòng `<img>` + object URL. */
export async function decodeSource(f: File): Promise<Source> {
  try {
    if (typeof createImageBitmap === "function") {
      const bmp = await createImageBitmap(f);
      return { width: bmp.width, height: bmp.height, draw: bmp, release: () => bmp.close() };
    }
  } catch {
    // rơi xuống đường dự phòng
  }
  const u = URL.createObjectURL(f);
  const img = new Image();
  img.src = u;
  await img.decode();
  return {
    width: img.naturalWidth,
    height: img.naturalHeight,
    draw: img,
    release: () => URL.revokeObjectURL(u),
  };
}

const makeCanvas = (w: number, h: number) => {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  return cv as unknown as Parameters<typeof cropToDataUrl>[3] extends (
    a: number,
    b: number,
  ) => infer R
    ? R
    : never;
};

/** Vẽ vùng cắt `rect` của `src` rồi mã hoá đúng cỡ/dung lượng của loại ảnh. */
export const cropDataUrl = (src: Source, rect: Rect, kind: ImageKind): Promise<string> =>
  cropToDataUrl(src.draw, rect, CROP[kind], makeCanvas, read);
