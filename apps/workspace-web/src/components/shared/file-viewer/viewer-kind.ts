// CR-149 · chọn cách XEM một tệp: ảnh raster ⇒ <img>, PDF ⇒ pdf.js, Word .docx ⇒ docx-preview, loại khác ⇒ tên + «Tải về».
// CR-194: văn bản thuần (.txt/.csv/.md/.log) ⇒ "text" (chỉ text node, không dựng HTML).
// SVG/HTML/.doc cũ/Excel luôn là "other" (không dựng nội tuyến ⇒ không có đường XSS).
export type ViewerKind = "image" | "pdf" | "docx" | "text" | "other";

const RASTER = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const TEXT_MIME = new Set(["text/plain", "text/csv", "text/markdown"]);
const TEXT_EXT = [".txt", ".csv", ".md", ".log"];
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Theo mime; mime chung chung (octet-stream/rỗng) ⇒ dựa đuôi tên `.pdf`/`.docx`. */
export function viewerKind(mime: string, name = ""): ViewerKind {
  const m = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  if (RASTER.has(m)) return "image";
  if (m === "application/pdf") return "pdf";
  if (m === DOCX_MIME) return "docx";
  if (TEXT_MIME.has(m)) return "text";
  if (m === "" || m === "application/octet-stream") {
    const n = name.toLowerCase();
    if (TEXT_EXT.some((e) => n.endsWith(e))) return "text";
    if (n.endsWith(".pdf")) return "pdf";
    if (n.endsWith(".docx")) return "docx";
  }
  return "other";
}
