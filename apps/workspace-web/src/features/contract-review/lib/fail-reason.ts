/** CR-122 p9 · FLOW2-FR-27 · fix-ai-unready (G3): mã lỗi lượt đọc ⇒ khoá lý do nghiệp vụ `contracts.review.failReason.*`.
 *  Mã lạ / TIMEOUT ⇒ undefined ⇒ câu chung `failedBody`. AI tạm ngưng (`AGENT_UNAVAILABLE`) có câu riêng, không phải "định dạng". */
const FAIL_REASON: Record<string, string> = {
  PDF_UNREADABLE: "unreadable",
  DOCX_UNREADABLE: "unreadable",
  TEXT_UNREADABLE: "unreadable",
  SOURCE_UNAVAILABLE: "unreadable",
  PDF_TOO_LARGE: "tooLarge",
  AGENT_UNAVAILABLE: "aiDown",
  AI_CAP_EXCEEDED: "cap",
};

export function failReasonKey(code: string | null | undefined): string | undefined {
  return code ? FAIL_REASON[code] : undefined;
}
