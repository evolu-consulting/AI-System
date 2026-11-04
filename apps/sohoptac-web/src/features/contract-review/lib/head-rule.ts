// lock-strict · CR-097 K1: luật thuần của thanh nút đầu trang HĐ (Huỷ / Lưu nháp / Xác nhận và lưu / Lưu thay đổi).
// - HĐ đã khoá: không có nút Lưu nào (mọi thông tin chỉ đọc).
// - `needs_review`: thanh dính (Huỷ + Lưu nháp [+ Xác nhận và lưu]); "Lưu nháp" CHỈ ghi (không xác nhận / khoá).
//   Tenant bật duyệt: nút xác nhận là của thẻ duyệt (`ap.view.confirm`); tenant tắt duyệt (bước duyệt = null): "Xác nhận và lưu" của trang.
// - Huỷ luôn làm gì đó: có sửa ⇒ bỏ sửa; chưa sửa ⇒ về danh sách.
export type HeadRuleIn = {
  status: string;
  locked: boolean;
  /** Vai ghi (đã loại `extracting`). */
  write: boolean;
  /** Đã tải trạng thái duyệt; bước duyệt hiện tại (null = tenant tắt duyệt / chưa có lượt). */
  approvalLoaded: boolean;
  approvalStep: string | null;
  /** Thẻ duyệt đang cho người này "Xác nhận" (bật duyệt, cấp 1). */
  approvalConfirm: boolean;
  edited: boolean;
};

export type HeadRule = {
  canSave: boolean;
  sticky: boolean;
  /** Nút "Lưu nháp" (chỉ ở `needs_review` và khi thẻ duyệt không đang giữ nút Xác nhận). */
  draftSave: boolean;
  /** Nút "Xác nhận và lưu" của trang (tenant tắt duyệt). */
  confirmSave: boolean;
  cancel: "reset" | "back";
};

export function headRule(i: HeadRuleIn): HeadRule {
  const canSave = i.write && i.status !== "extracting" && !i.locked;
  const review = i.status === "needs_review" && canSave;
  const off = i.approvalLoaded && i.approvalStep === null;
  return {
    canSave,
    sticky: review,
    draftSave: review && !i.approvalConfirm,
    confirmSave: review && off && !i.approvalConfirm,
    cancel: i.edited ? "reset" : "back",
  };
}
