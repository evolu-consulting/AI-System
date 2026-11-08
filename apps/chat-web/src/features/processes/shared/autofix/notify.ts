// HUB-FR-128 · P-c1 · toast lỗi tải tệp (chat-web: sonner). Bản admin-web khác ở file này (TECH-DEBT).
import { toast } from "@ai/web-kit/ui/toast";

export const notifyDownloadError = (message: string): void => {
  toast.error(message);
};
