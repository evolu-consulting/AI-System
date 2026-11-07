// Kiểu hiển thị thẻ duyệt (tách để approval.ts và engine-card.ts không vòng nhau).
export type ApprovalView = {
  confirm: boolean;
  approve: boolean;
  reject: boolean;
  redo: boolean;
  /** S4 · chỉ thẻ engine ở bước ≥ 1: "Đạt" / "Trả lại" (máy cũ không có ⇒ vắng). */
  pass?: boolean;
  back?: boolean;
  /** Khoá i18n dòng ghi chú (null ⇒ không hiện). */
  note: string | null;
};
