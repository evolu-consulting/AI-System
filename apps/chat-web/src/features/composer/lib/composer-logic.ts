// CHAT-AC-05, CHAT-AC-10 · luật thuần của ô nhập: phím, chiều cao tự giãn, khoá gửi, khoá nháp.
export const COMPOSER_MAX_ROWS = 8;
export const DRAFT_DEBOUNCE_MS = 300;

export type KeyInfo = { key: string; shiftKey: boolean; isComposing?: boolean };
export type KeyAction = "send" | "stop" | "none";

/** Enter gửi, Shift+Enter xuống dòng, Esc dừng; đang gõ IME (tiếng Việt) thì bỏ qua Enter. */
export function keyAction(e: KeyInfo, running: boolean): KeyAction {
  if (e.isComposing) return "none";
  if (e.key === "Enter" && !e.shiftKey) return "send";
  if (e.key === "Escape" && running) return "stop";
  return "none";
}

/** Chiều cao textarea: bám nội dung, tối đa `maxRows` dòng (quá thì cuộn trong ô). */
export function clampHeight(scrollHeight: number, lineHeight: number, maxRows: number): number {
  return Math.min(scrollHeight, lineHeight * maxRows);
}

export function canSend(text: string, locked: boolean, submitting: boolean): boolean {
  return !locked && !submitting && text.trim() !== "";
}

/** `chat:draft:<convId|new>:<flowId|main>` (plan-frontend §3). */
export function draftKey(convId: string | null, flowId: string | null): string {
  return `chat:draft:${convId ?? "new"}:${flowId ?? "main"}`;
}
