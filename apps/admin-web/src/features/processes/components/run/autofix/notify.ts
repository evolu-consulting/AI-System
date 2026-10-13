// HUB-FR-128 · P-c1 · toast lỗi tải tệp (admin-web: role alert, đóng tay). Bản chat-web khác ở file này (TECH-DEBT).
import { notifyError } from "@/components/shared/toast";

export const notifyDownloadError = (message: string): void => {
  notifyError(message);
};
