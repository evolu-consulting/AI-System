// CR-097 K1 · HD-FR-100 khoá cứng · decision 1 chặn tạo HĐ nhập tay mới. Mã lỗi riêng (không đụng `CONTRACT_ERRORS` của lát khác).
// CR-127 K4 · BR-38/39/74: khoá nội dung theo trạng thái (processing/done — sửa ⇒ "Tải phiên bản mới"); bỏ "Mở lại" (route/zod/usecase/repo).

export const LOCK_ERRORS = {
  /** HĐ đang duyệt (processing) hoặc đã xong (done): trường pháp lý / tiền / bên / ngày / điều khoản chỉ đọc cho mọi người. */
  CONTRACT_LOCKED: 409,
  /** Tải phiên bản mới từ HĐ chưa xong (mã dùng ở `upload.routes`). */
  CONTRACT_NOT_LOCKED: 409,
  /** Tạo HĐ nhập tay đã ngừng (HĐ phải có văn bản; nhập tay chuyển sang Giao dịch). */
  MANUAL_CONTRACT_DISABLED: 410,
  /** CR-101a (Câu 5): ngừng tạo phụ lục mới — sửa đổi qua "Tải bản cập nhật" (phiên bản). */
  USE_VERSIONS: 410,
} as const;
