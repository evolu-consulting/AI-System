// CR-147b · đọc tệp ảnh người chọn ⇒ data URL. Avatar: cắt vuông giữa ảnh, thu ≤ 256 px, xuất WebP (dự phòng PNG). Ảnh bìa: giữ nguyên tệp.
import { AVATAR_SIZE, squareCrop } from "../../domain/image";

const read = (f: Blob): Promise<string> =>
  new Promise((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => no(new Error("read"));
    r.readAsDataURL(f);
  });

export const coverDataUrl = read;

export async function avatarDataUrl(f: File): Promise<string> {
  const bmp = await createImageBitmap(f);
  const { sx, sy, side } = squareCrop(bmp.width, bmp.height);
  const out = Math.min(AVATAR_SIZE, side);
  const cv = document.createElement("canvas");
  cv.width = out;
  cv.height = out;
  cv.getContext("2d")?.drawImage(bmp, sx, sy, side, side, 0, 0, out, out);
  bmp.close();
  const blob = await new Promise<Blob | null>((r) => cv.toBlob(r, "image/webp", 0.9));
  return read(blob ?? f);
}
