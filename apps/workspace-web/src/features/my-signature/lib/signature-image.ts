// CR-181 · s3 · xử lý ảnh chữ ký ở trình duyệt. CR-188: phông ở `signature-fonts.ts`, dòng dưới chữ ký do người dùng nhập (không còn ngày). Phần tính toán trên mảng điểm ảnh (thuần, test được);
// phần canvas ở cuối mỏng. Q18: lưu nét ĐEN trên nền trong suốt, màu mực áp lúc in (xem trước dùng `recolor`).

import { DEFAULT_FONT, type FontKey, fontCss, loadSignatureFont } from "./signature-fonts";

export type Ink = "black" | "blue";
export type Method = "draw" | "upload" | "type";
export { DEFAULT_FONT, type FontKey, loadSignatureFont };

export const MAX_PNG_BYTES = 204800;
const TRIM_PAD = 6;
const INK_HEX: Record<Ink, string> = { black: "#111827", blue: "#1f3a8a" };

/** Hộp bao nét (alpha > 12) cộng viền 6px; không có nét ⇒ null. Toạ độ có thể âm/vượt (drawImage tự cắt). */
export function trimBox(data: Uint8ClampedArray, w: number, h: number) {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let i = 3; i < data.length; i += 4) {
    if ((data[i] ?? 0) <= 12) continue;
    const px = (i - 3) / 4;
    const x = px % w;
    const y = (px - x) / w;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  if (x1 < x0) return null;
  return {
    x: x0 - TRIM_PAD,
    y: y0 - TRIM_PAD,
    w: x1 - x0 + 1 + 2 * TRIM_PAD,
    h: y1 - y0 + 1 + 2 * TRIM_PAD,
  };
}

/** Ảnh chụp: độ sáng > 150 ⇒ trong suốt; tối hơn ⇒ càng tối càng đặc (như bản mẫu). Sửa tại chỗ. */
export function removeBackground(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const l = 0.3 * (data[i] ?? 0) + 0.59 * (data[i + 1] ?? 0) + 0.11 * (data[i + 2] ?? 0);
    data[i + 3] = l > 150 ? 0 : Math.min(255, (150 - l) * 3);
  }
}

/** Mọi điểm có nét ⇒ RGB đen, giữ alpha (Q18). Sửa tại chỗ. */
export function toBlackInk(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i + 3] ?? 0) > 0) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
    }
  }
}

/** Thử PNG ở các tỉ lệ nhỏ dần tới khi ≤ max byte; hết bậc vẫn vượt ⇒ trả bản nhỏ nhất. */
export async function fitPng(
  render: (scale: number) => Promise<Blob>,
  max = MAX_PNG_BYTES,
  scales: number[] = [1, 0.85, 0.7, 0.55, 0.4, 0.3, 0.2],
): Promise<Blob> {
  let last: Blob | null = null;
  for (const s of scales) {
    last = await render(s);
    if (last.size <= max) return last;
  }
  return last as Blob;
}

/** Khoá lỗi khi bấm Lưu mà chưa có chữ ký; có rồi ⇒ null. */
export function missingError(
  how: Method,
  s: { drawn: boolean; upload: boolean; name: string },
): "errDraw" | "errUpload" | "errType" | null {
  if (how === "draw") return s.drawn ? null : "errDraw";
  if (how === "upload") return s.upload ? null : "errUpload";
  return s.name.trim() ? null : "errType";
}

/** Các cách tạo được phép, giữ thứ tự cố định Vẽ · Tải ảnh · Gõ họ tên. */
export function allowedMethods(m: Record<Method, boolean> | Method[]): Method[] {
  const on = (k: Method) => (Array.isArray(m) ? m.includes(k) : m[k]);
  return (["draw", "upload", "type"] as Method[]).filter(on);
}

// ---------- phần canvas (trình duyệt) ----------
const make = (w: number, h: number) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};

/** Cắt sát nét (viền 6px); trống ⇒ null. */
export function trimCanvas(src: HTMLCanvasElement): HTMLCanvasElement | null {
  const ctx = src.getContext("2d");
  if (!ctx) return null;
  const box = trimBox(ctx.getImageData(0, 0, src.width, src.height).data, src.width, src.height);
  if (!box) return null;
  const o = make(box.w, box.h);
  o.getContext("2d")?.drawImage(src, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  return o;
}

/** Ảnh tải lên ⇒ canvas đã xoá nền + cắt sát; không đọc được ⇒ null. */
export async function canvasFromImageFile(file: Blob): Promise<HTMLCanvasElement | null> {
  const url = URL.createObjectURL(file);
  try {
    const im = await new Promise<HTMLImageElement | null>((ok) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => ok(null);
      i.src = url;
    });
    if (!im) return null;
    const k = Math.min(1, 1200 / im.width);
    const c = make(Math.max(1, Math.round(im.width * k)), Math.max(1, Math.round(im.height * k)));
    const x = c.getContext("2d");
    if (!x) return null;
    x.drawImage(im, 0, 0, c.width, c.height);
    const d = x.getImageData(0, 0, c.width, c.height);
    removeBackground(d.data);
    x.putImageData(d, 0, 0);
    return trimCanvas(c);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Chữ ký gõ: tên bằng phông viết tay + nét gạch, nét đen trên nền trong suốt. */
export async function canvasFromName(
  name: string,
  font: FontKey = DEFAULT_FONT,
): Promise<HTMLCanvasElement | null> {
  await loadSignatureFont(font);
  const text = name.trim();
  const c = make(1100, 300);
  const x = c.getContext("2d");
  if (!x || !text) return null;
  x.font = fontCss(font, 110);
  // Phông rộng (Pacifico…) + tên dài: co cỡ chữ cho vừa khung 1100 (chừa lề + nét gạch).
  const wide = x.measureText(text).width;
  if (wide > 1000) x.font = fontCss(font, Math.max(40, Math.floor((110 * 1000) / wide)));
  x.fillStyle = "#000";
  x.strokeStyle = "#000";
  x.textBaseline = "middle";
  x.fillText(text, 30, 150);
  x.lineWidth = 4;
  x.beginPath();
  x.moveTo(40, 225);
  x.quadraticCurveTo(450, 255, Math.min(1050, 60 + x.measureText(text).width), 215);
  x.stroke();
  return trimCanvas(c);
}

/** Canvas đã cắt ⇒ PNG nét đen nền trong suốt, ≤ 200 KB. */
export async function toSignaturePng(src: HTMLCanvasElement): Promise<Blob> {
  const d = src.getContext("2d")?.getImageData(0, 0, src.width, src.height);
  const base = make(src.width, src.height);
  if (d) {
    toBlackInk(d.data);
    base.getContext("2d")?.putImageData(d, 0, 0);
  }
  return fitPng(
    (s) =>
      new Promise<Blob>((ok, no) => {
        let c = base;
        if (s !== 1) {
          c = make(
            Math.max(1, Math.round(base.width * s)),
            Math.max(1, Math.round(base.height * s)),
          );
          c.getContext("2d")?.drawImage(base, 0, 0, c.width, c.height);
        }
        c.toBlob((b) => (b ? ok(b) : no(new Error("png"))), "image/png");
      }),
  );
}

/** Bản đổi màu mực để xem trước (ảnh lưu vẫn đen). */
export function recolor(src: HTMLCanvasElement, ink: Ink): HTMLCanvasElement {
  const o = make(src.width, src.height);
  const x = o.getContext("2d");
  if (!x) return o;
  x.drawImage(src, 0, 0);
  x.globalCompositeOperation = "source-in";
  x.fillStyle = INK_HEX[ink];
  x.fillRect(0, 0, o.width, o.height);
  return o;
}

/** Vẽ khung xem trước: chữ ký theo màu mực + dòng dưới chữ ký (+ dòng «Ký ngày …» khi xem trước trên tài liệu). */
export function drawPreview(
  cnv: HTMLCanvasElement,
  sig: HTMLCanvasElement | null,
  ink: Ink,
  lines: { caption: string; signedOn?: string },
) {
  const { caption, signedOn } = lines;
  const x = cnv.getContext("2d");
  if (!x) return;
  x.clearRect(0, 0, cnv.width, cnv.height);
  if (sig) {
    const s = Math.min(560 / sig.width, 170 / sig.height);
    x.drawImage(recolor(sig, ink), 70, 20, sig.width * s, sig.height * s);
  }
  x.fillStyle = INK_HEX[ink];
  x.font = "22px sans-serif";
  x.fillText(caption, 70, signedOn ? 218 : 230, 560);
  if (signedOn) x.fillText(signedOn, 70, 246, 560);
}
