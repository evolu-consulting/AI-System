// Nhãn nghiệp vụ của bản ghi gắn lượt chạy (`record_label`, vd mã HĐ thật) — MỘT hàm cho bảng Lượt chạy (trình sửa + trang chỉ-xem)
// và khối "Đang chạy" của Công ty › Quy trình. Lượt không gắn hồ sơ ⇒ "—" / null (không lộ id thô).
export type WithRecordLabel = { record_label?: string | null };

/** Nhãn đã cắt khoảng trắng, hoặc null khi không có. */
export const recordLabel = (r: WithRecordLabel): string | null => r.record_label?.trim() || null;

/** Nhãn để hiện trong ô bảng: nhãn hoặc "—". */
export const recordLabelText = (r: WithRecordLabel): string => recordLabel(r) ?? "—";
