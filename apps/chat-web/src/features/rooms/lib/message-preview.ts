// X2a-AC · xem trước tin cuối ở FE khớp `previewOf` server (hub-api `rooms.rules`, R15): gộp khoảng trắng, cắt theo code point.
// Server giữ bản riêng (không nằm trong `@ai/contracts/chat`); đổi thuật toán phải đổi cả hai.
import { ROOM_PREVIEW_MAX } from "@ai/contracts/chat";

export function messagePreview(content: string): string {
  const flat = content.replace(/\s+/g, " ").trim();
  return Array.from(flat).slice(0, ROOM_PREVIEW_MAX).join("");
}
