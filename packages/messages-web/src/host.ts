// CR-169 · lát 5a · cổng tiêm của gói: mỗi app gắn transport có xác thực/base URL, luồng sự kiện và danh tính người dùng.
// Gói không import code app; app gọi `configureMessagesHost` một lần lúc khởi động (trước khi render mục Tin nhắn).
import type { RequestOptions } from "@ai/web-kit/http";

export type StreamFrame = { event: string; data: string };

export type MessagesHost = {
  /** Gọi API (JSON) đã gắn Bearer/base URL của app. */
  api: <T>(path: string, opts?: RequestOptions) => Promise<T>;
  /** Luồng `/me/stream`: đăng ký sự kiện, trả hàm huỷ; `onReconnected` gọi khi nối lại sau đứt. */
  subscribe: (
    event: string,
    handler: (frame: StreamFrame) => void,
    onReconnected?: () => void,
  ) => () => void;
  /** Id người dùng hiện tại (không đọc được ⇒ `undefined`). */
  myId: () => string | undefined;
  /** Hook (gọi như hook React): khoá phạm vi `tenant:user` ("" khi chưa đăng nhập). */
  useScope: () => string;
};

let host: MessagesHost | null = null;

export function configureMessagesHost(next: MessagesHost | null): void {
  host = next;
}

export function messagesHost(): MessagesHost {
  if (!host) throw new Error("messages-web: chưa gọi configureMessagesHost");
  return host;
}
