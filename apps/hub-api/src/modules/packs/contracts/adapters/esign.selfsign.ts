// cf-esign-docusign · adapter `selfsign` = KÝ THỬ (demo, `ESIGN_PROVIDER=selfsign`) khi chưa có tài khoản CA/DocuSign: không gọi mạng,
// không chứng thư, KHÔNG có giá trị pháp lý (UI ghi rõ "Ký thử – không có giá trị pháp lý"). Không trạng thái phía nhà cung cấp:
// đọc trạng thái luôn "sent" (Làm mới không đổi gì); CHỈ khi người ký nhúng bấm "Ký ngay" use case mới hoàn tất (esign-fix, cờ
// `demo`). "Bản đã ký" = bản PDF gốc của HĐ (hậu tố "-ky-thu") — không đóng dấu vào PDF vì ký PAdES / sửa PDF cần thư viện mới.
import type { ESignProvider } from "../application/esign.ports";

export function selfsignProvider(): ESignProvider {
  return {
    key: "selfsign",
    demo: true,
    async createEnvelope() {
      return { envelopeId: `selfsign-${crypto.randomUUID()}` };
    },
    async getEnvelope() {
      return { status: "sent", reason: null, completedAt: null, recipients: [] };
    },
    async recipientView(_id, _r, returnUrl) {
      return returnUrl;
    },
    async combinedPdf() {
      return null;
    },
    async voidEnvelope() {},
  };
}
