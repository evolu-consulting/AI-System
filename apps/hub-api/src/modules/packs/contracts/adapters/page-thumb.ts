// CR-125 · x12 · ảnh thu nhỏ TRANG ĐẦU của PDF cho email "Mời ký số" (chỉ trang 1, không gửi PDF). Dựng ở máy chủ bằng `unpdf` (pdf.js) + `@napi-rs/canvas`:
// trang 1 → PNG → thu về rộng ≤ 560 px → JPEG (chất lượng 70, ~30–60 KB). Mọi lỗi (PDF hỏng/mã hoá, thiếu canvas native, quá lớn) ⇒ null — bên gọi bỏ ảnh, giữ thẻ tóm tắt.
// Không đọc/ghi gì ngoài bộ nhớ; không log nội dung.
import { renderPageAsImage } from "unpdf";

export type Thumb = { b64: string; width: number; height: number };
export type RenderThumb = (pdf: Uint8Array) => Promise<Thumb | null>;

const MAX_PDF_BYTES = 25 * 1024 * 1024;
const WIDTH = 560;
const MAX_JPEG_BYTES = 120 * 1024;

export const renderFirstPage: RenderThumb = async (pdf) => {
  if (pdf.length === 0 || pdf.length > MAX_PDF_BYTES) return null;
  try {
    const canvasMod = await import("@napi-rs/canvas");
    // `renderPageAsImage` có thể chuyển (detach) bộ đệm đầu vào ⇒ đưa bản sao.
    const png = await renderPageAsImage(new Uint8Array(pdf), 1, {
      canvasImport: () => Promise.resolve(canvasMod),
      scale: 1.5,
    });
    const img = await canvasMod.loadImage(Buffer.from(png));
    const w = Math.min(WIDTH, img.width);
    const h = Math.max(1, Math.round((img.height * w) / img.width));
    const canvas = canvasMod.createCanvas(w, h);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const jpeg = canvas.toBuffer("image/jpeg", 70);
    if (jpeg.length === 0 || jpeg.length > MAX_JPEG_BYTES) return null;
    return { b64: jpeg.toString("base64"), width: w, height: h };
  } catch {
    return null;
  }
};
