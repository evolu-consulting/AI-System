// X2a · toast phòng có `role="status"` (sonner 2 không tự gắn role) để đọc màn hình + e2e (`status`) thấy được.
import { toast } from "sonner";

export function roomToast(message: string): void {
  toast(<span role="status">{message}</span>);
}
