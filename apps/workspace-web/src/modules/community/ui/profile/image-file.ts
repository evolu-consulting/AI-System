// CR-147b · đọc tệp ảnh người chọn ⇒ data URL. Avatar: cắt vuông giữa ảnh, thu ≤ 256 px, xuất WebP rồi JPEG nhẹ dần tới ≤ 150 KB; không được ⇒ lỗi (không gửi tệp gốc). Ảnh bìa: giữ nguyên tệp.
import { encodeAvatar } from "../../domain/avatar-encode";
import { AVATAR_SIZE, squareCrop } from "../../domain/image";

const read = (f: Blob): Promise<string> =>
  new Promise((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => no(new Error("read"));
    r.readAsDataURL(f);
  });

export const coverDataUrl = read;

type Source = { width: number; height: number; draw: CanvasImageSource; release: () => void };

/** Giải mã ảnh: `createImageBitmap` trước; không có/lỗi ⇒ dự phòng `<img>` + object URL. */
async function decodeSource(f: File): Promise<Source> {
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

export async function avatarDataUrl(f: File): Promise<string> {
  const src = await decodeSource(f);
  try {
    const { sx, sy, side } = squareCrop(src.width, src.height);
    const out = Math.min(AVATAR_SIZE, side);
    const cv = document.createElement("canvas");
    cv.width = out;
    cv.height = out;
    cv.getContext("2d")?.drawImage(src.draw, sx, sy, side, side, 0, 0, out, out);
    return await encodeAvatar(cv, read);
  } finally {
    src.release();
  }
}
