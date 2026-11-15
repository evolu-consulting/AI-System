// CR-122 p9 · CR-155 · fix-ai-unready (G3): mã lỗi đọc (`contract.error`) ⇒ khoá câu lý do nghiệp vụ (gợi ý "Nhập tay"). `TIMEOUT` = AI đọc quá lâu (máy chủ hết
// giờ đọc); `STALE` = lượt đọc bị mất giữa chừng — cùng câu «AI đọc quá lâu». `AGENT_UNAVAILABLE` = AI tạm ngưng (câu riêng `aiDown`).
// Mã lạ/vắng ⇒ undefined (dùng câu chung).
const FAIL_REASON: Record<string, string> = {
  PDF_UNREADABLE: "unreadable",
  DOCX_UNREADABLE: "unreadable",
  TEXT_UNREADABLE: "unreadable",
  SOURCE_UNAVAILABLE: "unreadable",
  PDF_TOO_LARGE: "tooLarge",
  AGENT_UNAVAILABLE: "aiDown",
  AI_CAP_EXCEEDED: "cap",
  TIMEOUT: "timeout",
  STALE: "timeout",
};

export const failReasonKey = (error: string | null | undefined): string | undefined =>
  error ? FAIL_REASON[error] : undefined;
