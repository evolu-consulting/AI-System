// CHAT-AC-57: toast có `role="status"` (sonner 2 không tự gắn role) để đọc màn hình + e2e thấy được.
import { toast } from "@ai/web-kit/ui/toast";

export function askToast(message: string): void {
  toast(<span role="status">{message}</span>);
}
