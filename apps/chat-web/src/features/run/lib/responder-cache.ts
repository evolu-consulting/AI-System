// HUB-FR-91 · nhớ `responder` của câu trả lời đã chốt để khối flow không đổi nhãn về "Consultant" khi run bị bỏ
// (`drop`) trước khi preview/E11 mang `Message.responder`. Chỉ trong bộ nhớ, tối đa `MAX` mục (cũ nhất bị bỏ trước).
import type { Responder } from "@ai/contracts/chat";

const MAX = 200;
const cache = new Map<string, Responder>();

export function rememberResponder(messageId: string, responder: Responder): void {
  cache.delete(messageId);
  cache.set(messageId, responder);
  if (cache.size > MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

export const recallResponder = (messageId: string): Responder | undefined => cache.get(messageId);
export const clearResponders = (): void => cache.clear();
