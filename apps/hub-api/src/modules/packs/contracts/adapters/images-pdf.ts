// CR-122 p9 · FLOW2-FR-27: ghép nhiều ảnh chụp trang (JPG/PNG) thành MỘT PDF để lưu + đọc như PDF scan. `pdf-lib` (người dùng duyệt,
// xem ADR-0039) nhúng ảnh (`embedJpg`/`embedPng`); mỗi ảnh một trang, cỡ trang = cỡ ảnh. WEBP/HEIC ⇒ không nhận (null).
import { PDFDocument } from "pdf-lib";

/** Trần điểm ảnh một PNG phải giải mã trong bộ nhớ (≈ 40 triệu điểm = ảnh 8000×5000) — chặn PNG nhỏ khai cỡ khổng lồ. */
export const PNG_MAX_PIXELS = 40_000_000;

const startsWith = (b: Uint8Array, sig: readonly number[]) => sig.every((v, i) => b[i] === v);
const isJpeg = (b: Uint8Array) => startsWith(b, [0xff, 0xd8, 0xff]);
const isPng = (b: Uint8Array) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Cỡ khai ở IHDR (byte 16–23) — kiểm trước khi để thư viện giải nén. */
function pngTooBig(b: Uint8Array): boolean {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return b.length < 24 || dv.getUint32(16) * dv.getUint32(20) > PNG_MAX_PIXELS;
}

/** Ghép theo thứ tự đưa vào; bất kỳ ảnh nào không đọc được ⇒ null (người gọi báo "không đọc được ảnh"). */
export async function imagesToPdf(images: readonly Uint8Array[]): Promise<Uint8Array | null> {
  if (images.length === 0) return null;
  try {
    const doc = await PDFDocument.create();
    for (const b of images) {
      if (!isJpeg(b) && !(isPng(b) && !pngTooBig(b))) return null;
      const img = isJpeg(b) ? await doc.embedJpg(b) : await doc.embedPng(b);
      doc.addPage([img.width, img.height]).drawImage(img, { x: 0, y: 0, ...img.size() });
    }
    return await doc.save({ useObjectStreams: false });
  } catch {
    return null;
  }
}
