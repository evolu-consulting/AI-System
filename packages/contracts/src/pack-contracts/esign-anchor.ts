// esign-anchor · vị trí ô ký: danh sách cụm tìm trong văn bản HĐ cho Bên A (công ty) / Bên B (đối tác) — Cài đặt › Ký số
// (`GET/PUT /pack/contracts/esign/anchors`, owner sửa) + xem trước vị trí khi Gửi ký (`GET /contracts/:id/esign/placement`).
import { z } from "zod";

const Phrase = z
  .string()
  .transform((v) => v.normalize("NFC").replace(/\s+/g, " ").trim())
  // esign-anchor-fix · chặn ký tự điều khiển (\u0000 ⇒ jsonb lỗi 500); xuống dòng/tab đã gộp thành khoảng trắng ở trên.
  .pipe(
    z
      .string()
      .min(2)
      .max(60)
      .regex(/^[^\p{Cc}]+$/u),
  );

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

/** "text" = ô ký đặt ngay dưới cụm trong văn bản HĐ; "page" = trang ký cuối (nối thêm); "unknown" = xem trước bận (đọc PDF), chưa
 *  xác định — lúc gửi vẫn tự chọn. */
export type ESignPlacement = "text" | "page" | "unknown";
export type ESignPlacementOut = { placement: ESignPlacement };
