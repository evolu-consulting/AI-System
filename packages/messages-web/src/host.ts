// CR-169 · lát 5a · cổng tiêm của gói: mỗi app gắn transport có xác thực/base URL, luồng sự kiện và danh tính người dùng.
// Gói không import code app; app gọi `configureMessagesHost` một lần lúc khởi động (trước khi render mục Tin nhắn).
import type { RequestOptions } from "@ai/web-kit/http";
import type { ComponentType, ReactNode } from "react";

/** Bộ giao diện nền của app (shadcn/theme của app) — gói không chép lại để mỗi app giữ đúng giao diện của mình. */
export type MessagesUi = {
  cn: (...classes: Array<string | false | null | undefined>) => string;
  Skeleton: ComponentType<{ className?: string }>;
  Dialog: ComponentType<{
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children?: ReactNode;
  }>;
  DialogContent: ComponentType<{
    className?: string;
    children?: ReactNode;
    "data-testid"?: string;
  }>;
  DialogHeader: ComponentType<{ className?: string; children?: ReactNode }>;
  DialogTitle: ComponentType<{ className?: string; children?: ReactNode }>;
  DialogDescription: ComponentType<{ className?: string; children?: ReactNode }>;
  /** Hộp xác nhận kiểu lệnh (như `confirmDialog` của app). */
  confirm: (o: {
    title: string;
    body?: ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
  }) => Promise<boolean>;
};

export type StreamFrame = { event: string; data: string };

export type MessagesHost = {
  /** Gọi API (JSON) đã gắn Bearer/base URL của app. */
  api: <T>(path: string, opts?: RequestOptions) => Promise<T>;
  /** Như `api` nhưng trả `Response` thô (byte tệp để xem trước; đã gắn Bearer). */
  apiResponse: (path: string, opts?: RequestOptions) => Promise<Response>;
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
  /** Hook: công ty của người dùng (chip «<Tên công ty mình>», nhận diện nhắn nội bộ hay `partner`); chưa đăng nhập ⇒ null. */
  useOwnCompany: () => { id: string; name: string } | null;
  ui: MessagesUi;
};

let host: MessagesHost | null = null;

export function configureMessagesHost(next: MessagesHost | null): void {
  host = next;
}

export function messagesHost(): MessagesHost {
  if (!host) throw new Error("messages-web: chưa gọi configureMessagesHost");
  return host;
}
