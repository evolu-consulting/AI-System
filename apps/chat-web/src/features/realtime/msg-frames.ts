// CR-169 · khung `msg.*` / `cc.link` của `/me/stream` đi thẳng (chưa phân tích) tới gói `@ai/messages-web` — gói tự kiểm schema.
// Cùng một kết nối với phòng/quy trình (không mở thêm); nối lại sau đứt ⇒ báo người nghe để tải lại.
type Frame = { event: string; data: string };
type Handler = (f: Frame) => void;

const handlers = new Map<string, Set<Handler>>();
const reconnects = new Set<() => void>();

/** Sự kiện thuộc gói Tin nhắn: không đi qua parser chat (parser chat sẽ bỏ khung lạ). */
export const isMessagesFrame = (event: string): boolean =>
  event.startsWith("msg.") || event === "cc.link";

export function subscribeMsgFrames(
  event: string,
  handler: Handler,
  onReconnected?: () => void,
): () => void {
  const h: Handler = (f) => handler(f); // cùng hàm đăng ký hai lần = hai người nghe độc lập
  const r = onReconnected ? () => onReconnected() : undefined;
  const set = handlers.get(event) ?? new Set<Handler>();
  handlers.set(event, set);
  set.add(h);
  if (r) reconnects.add(r);
  return () => {
    handlers.get(event)?.delete(h);
    if (r) reconnects.delete(r);
  };
}

export function dispatchMsgFrame(f: Frame): void {
  for (const h of handlers.get(f.event) ?? []) h(f);
}

export function notifyMsgReconnected(): void {
  for (const r of [...reconnects]) r();
}
