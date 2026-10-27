// esign-anchor · vị trí ô ký: danh sách cụm tìm trong văn bản HĐ cho Bên A (công ty) / Bên B (đối tác) — Cài đặt › Ký số
// (`GET/PUT /pack/contracts/esign/anchors`, owner sửa) + xem trước vị trí khi Gửi ký (`GET /contracts/:id/esign/placement`).
import { z } from "zod";

const Phrase = z
  .string()
  .transform((v) => v.normalize("NFC").replace(/\s+/g, " ").trim())
  .pipe(z.string().min(2).max(60));

/** Mỗi bên 1–8 cụm, theo thứ tự ưu tiên (cụm cụ thể trước, vd "ĐẠI DIỆN BÊN A" rồi "BÊN A"). */
export const ESignAnchorsSchema = z.strictObject({
  a: z.array(Phrase).min(1).max(8),
  b: z.array(Phrase).min(1).max(8),
});
export type ESignAnchorsIn = z.infer<typeof ESignAnchorsSchema>;

export type ESignAnchorsOut = {
  a: string[];
  b: string[];
  /** Công ty chưa sửa ⇒ đang dùng mặc định. */
  is_default: boolean;
};

/** "text" = ô ký đặt ngay dưới cụm trong văn bản HĐ; "page" = trang ký cuối (nối thêm). */
export type ESignPlacement = "text" | "page";
export type ESignPlacementOut = { placement: ESignPlacement };
