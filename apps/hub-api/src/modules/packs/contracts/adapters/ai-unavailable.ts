// fix-ai-unready · AI chưa cấu hình (không Claude CLI / chưa đăng nhập / không khoá) ⇒ lượt đọc kết thúc NGAY bằng
// `AGENT_UNAVAILABLE` qua đường ghi lỗi sẵn có của use case, không chờ vòng quét STALE.
import type { ExtractionAgent } from "../application/extraction.ports";

export const unavailableAgent: ExtractionAgent = {
  extract: async () => ({ ok: false, code: "AGENT_UNAVAILABLE" }),
};
