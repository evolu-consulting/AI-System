// CHAT-AC-05, CHAT-AC-10 · luật thuần của ô nhập: phím, chiều cao tự giãn, khoá gửi, khoá nháp.
import { DRAFT_KEY_PREFIX } from "~/lib/storage";

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

/** Kết quả `onSubmit`: `sent` xoá chữ; `error` giữ chữ + có thể hiện thông báo; `kept` chỉ giữ chữ. */
export function submitOutcome<E>(
  r: boolean | { ok: true } | { ok: false; error: E },
): { kind: "sent" } | { kind: "kept" } | { kind: "error"; error: E } {
  if (r === true || (typeof r === "object" && r.ok)) return { kind: "sent" };
  return typeof r === "object" && !r.ok ? { kind: "error", error: r.error } : { kind: "kept" };
}

export type MenuKeyAction = "dismiss" | "next" | "prev" | "pick";

/** Phím khi menu gợi ý đang mở: Esc đóng; ↑↓ và Enter/Tab chỉ khi có dòng; Shift+Enter xuống dòng bình thường. */
export function menuKeyAction(e: KeyInfo, hasRows: boolean): MenuKeyAction | null {
  if (e.isComposing) return null;
  if (e.key === "Escape") return "dismiss";
  if (!hasRows) return null;
  if (e.key === "ArrowDown") return "next";
  if (e.key === "ArrowUp") return "prev";
  if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) return "pick";
  return null;
}

/** Chiều cao textarea: bám nội dung, tối đa `maxRows` dòng (quá thì cuộn trong ô). */
export function clampHeight(scrollHeight: number, lineHeight: number, maxRows: number): number {
  return Math.min(scrollHeight, lineHeight * maxRows);
}

/** Quá `max` ký tự (phòng: `CHAT_CONTENT_MAX`); `max` rỗng = không giới hạn. */
export function overLimit(text: string, max: number | undefined): boolean {
  return max !== undefined && text.length > max;
}

/** Nhãn + placeholder của textbox: `override` (phòng) thắng; không thì theo `flow`. */
export function inputLabels(
  t: (key: string) => string,
  flow: boolean,
  override?: string,
): { input: string; placeholder: string } {
  if (override) return { input: override, placeholder: override };
  return flow
    ? { input: t("composer.flowInput"), placeholder: t("composer.flowPlaceholder") }
    : { input: t("composer.input"), placeholder: t("composer.placeholder") };
}

export function canSend(text: string, locked: boolean, submitting: boolean): boolean {
  return !locked && !submitting && text.trim() !== "";
}

/**
 * `chat:draft:<userId|anon>:<convId|new>:<flowId|main>` (plan-frontend §3). Gắn user để máy dùng chung không lộ nháp
 * của người trước; mọi `chat:draft:*` còn bị xoá khi phiên `cleared`/`expired` (`lib/auth/session`).
 */
export function draftKey(
  userId: string | null,
  convId: string | null,
  flowId: string | null,
): string {
  return `${DRAFT_KEY_PREFIX}${userId ?? "anon"}:${convId ?? "new"}:${flowId ?? "main"}`;
}
