// CR-144 · tệp bằng chứng duyệt: chỉ ảnh raster + PDF được hiển thị nội tuyến (`?inline=1`); SVG/HTML/loại khác luôn tải xuống (chống XSS).
const INLINE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

export const canInline = (mime: string): boolean =>
  INLINE_MIME.has(mime.split(";")[0]?.trim().toLowerCase() ?? "");

export function evidenceHeaders(
  f: { name: string; mime: string; size: number },
  inline: boolean,
): Record<string, string> {
  const show = inline && canInline(f.mime);
  return {
    "content-type": show
      ? f.mime.split(";")[0]?.trim().toLowerCase() || ""
      : f.mime || "application/octet-stream",
    "content-length": String(f.size),
    "content-disposition": `${show ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    "x-content-type-options": "nosniff",
    "cache-control": "private, no-store",
  };
}
