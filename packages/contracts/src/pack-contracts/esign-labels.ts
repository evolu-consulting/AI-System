// CR-125 · c1 · MỘT mô hình trạng thái ký số cho mọi màn hình: nguồn = trạng thái PHONG BÌ (`ESignEnvelopeOut.status`); dòng ký số của
// thẻ duyệt (`ContractApproval.esign.status`: pending/sending/sent/completed/needs_decision) quy về cùng nhóm khoá i18n `contracts.esign.*`,
// nên một màn hình không bao giờ hiện cả "Đã ký số" lẫn "Đã ký xong" cho cùng một việc. Thuần.
const KEY: Readonly<Record<string, string>> = {
  // trạng thái phong bì
  sent: "contracts.esign.pending",
  delivered: "contracts.esign.pending",
  completed: "contracts.esign.signed",
  declined: "contracts.esign.declined",
  voided: "contracts.esign.voided",
  // chỉ có ở dòng ký số của thẻ (chưa có phong bì / đang gửi / cần xử lý)
  sending: "contracts.esign.sending",
  pending: "contracts.approval.esign.status.pending",
  needs_decision: "contracts.approval.esign.status.needs_decision",
};

/** Khoá i18n của nhãn trạng thái ký số; trạng thái lạ ⇒ nhãn "chờ ký" an toàn. */
export const esignLabelKey = (status: string): string => KEY[status] ?? "contracts.esign.pending";
