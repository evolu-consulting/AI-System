// cf-esign-docusign · adapter `selfsign` = KÝ THỬ (demo, `ESIGN_PROVIDER=selfsign`) khi chưa có tài khoản CA/DocuSign: không gọi mạng,
// không chứng thư, KHÔNG có giá trị pháp lý (UI ghi rõ "Ký thử – không có giá trị pháp lý"). Không trạng thái: giao dịch coi như ký
// xong ở lần đọc trạng thái đầu tiên (sau "Ký ngay" hoặc "Làm mới trạng thái"); "Bản đã ký" = bản PDF gốc của HĐ (tên có hậu tố
// "-ky-thu") — không đóng dấu vào PDF vì ký PAdES / sửa PDF cần thư viện mới (không thêm, xem tasks.md).
import type { ESignProvider } from "../application/esign.ports";

export function selfsignProvider(d: { now?: () => Date } = {}): ESignProvider {
  const now = d.now ?? (() => new Date());
  return {
    key: "selfsign",
    demo: true,
    async createEnvelope() {
      return { envelopeId: `selfsign-${crypto.randomUUID()}` };
    },
    async getEnvelope() {
      return {
        status: "completed",
        reason: null,
        completedAt: now().toISOString(),
        recipients: [],
      };
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
