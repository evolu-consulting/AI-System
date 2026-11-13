// CR-144 · phân loại tệp bằng chứng để hiển thị: ảnh raster ⇒ <img>, PDF ⇒ khung PDF, loại khác ⇒ tên + biểu tượng (không SVG nội tuyến).
export type EvidenceKind = "image" | "pdf" | "other";

const RASTER = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function evidenceKind(mime: string): EvidenceKind {
  const m = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  if (RASTER.has(m)) return "image";
  return m === "application/pdf" ? "pdf" : "other";
}
