// HUB-H2c-AC-17 · file mẫu cho smoke `h2c-live.test.ts` (sinh lúc chạy, không lưu file nhị phân trong repo): PDF tối thiểu
// nhiều trang (Helvetica, chữ ASCII) và PNG xám chữ bitmap 5×7 phóng to.
import { deflateSync } from "node:zlib";

export const PDF_PAGES = [
  "Page one says: the blue heron sleeps at noon.",
  "Page two says: seven green lanterns guard the old bridge.",
] as const;
export const PNG_TEXT = "ZEBRA 47";

/** PDF tối thiểu, mỗi phần tử `pages` một trang (Helvetica 20pt, chữ ASCII). */
export function makePdf(pages: readonly string[]): Uint8Array {
  const n = pages.length;
  const objs: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + 2 * i} 0 R`).join(" ")}] /Count ${n} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (const [i, text] of pages.entries()) {
    const stream = `BT /F1 20 Tf 50 700 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`;
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + 2 * i} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  }
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [i, o] of objs.entries()) {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

const GLYPHS: Record<string, string[]> = {
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array(4 + data.length);
  body.set(new TextEncoder().encode(type), 0);
  body.set(data, 4);
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(body, 4);
  dv.setUint32(8 + data.length, Bun.hash.crc32(body) >>> 0);
  return out;
}

/** Tô chấm font ở toạ độ chấm (x0, y0) thành ô `scale`×`scale` đen trong ảnh thô (mỗi dòng 1 byte filter + `w`). */
function dot(raw: Uint8Array, w: number, scale: number, x0: number, y0: number): void {
  for (let dy = 0; dy < scale; dy++) {
    const start = (y0 * scale + dy) * (w + 1) + 1 + x0 * scale;
    raw.fill(0, start, start + scale);
  }
}

/** Ảnh thô xám (filter None mỗi dòng): `text` theo font 5×7, lề 2 chấm, khoảng cách 1 chấm. */
function rasterize(text: string, scale: number): { raw: Uint8Array; w: number; h: number } {
  const w = (text.length * 6 + 3) * scale;
  const h = 11 * scale;
  const raw = new Uint8Array(h * (w + 1)).fill(255);
  for (let y = 0; y < h; y++) raw[y * (w + 1)] = 0;
  for (const [ci, ch] of [...text].entries()) {
    const rows = GLYPHS[ch] ?? [];
    for (const [gy, row] of rows.entries())
      for (const [gx, bit] of [...row].entries())
        if (bit === "1") dot(raw, w, scale, 2 + ci * 6 + gx, 2 + gy);
  }
  return { raw, w, h };
}

/** PNG xám 8-bit: chữ đen (font bitmap 5×7 `GLYPHS`) trên nền trắng, mỗi chấm `scale` px. */
export function makePng(text: string, scale = 16): Uint8Array {
  const { raw, w, h } = rasterize(text, scale);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr.set([8, 0, 0, 0, 0], 8);
  const sig = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", new Uint8Array()),
  ];
  return Uint8Array.from(parts.flatMap((p) => [...p]));
}
