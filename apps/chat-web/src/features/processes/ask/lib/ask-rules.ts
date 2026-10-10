// CHAT-AC-57 · HUB-FR-110/111 · plan-frontend §4: luật thuần của hỏi lại (chế độ chip, trần chuyển, validate, mã lỗi → khoá i18n).
import {
  ANSWER_MAX,
  FORWARD_CHAIN_MAX,
  FORWARD_NOTE_MAX,
  type TaskDetail,
  type TaskForward,
} from "@ai/contracts/chat";

export { ANSWER_MAX, FORWARD_CHAIN_MAX, FORWARD_NOTE_MAX };

/** Hub gộp nhiều câu thành "1. … 2. …" (≥ 2 dòng bắt đầu bằng số) ⇒ `multi`: chip chèn vào ô, không gửi ngay. */
export function askMode(question: string): "single" | "multi" {
  const numbered = question.split("\n").filter((l) => /^\s*\d+[.)]/.test(l)).length;
  return numbered >= 2 ? "multi" : "single";
}

export const forwardsLeft = (forwards: readonly unknown[]): number =>
  Math.max(FORWARD_CHAIN_MAX - forwards.length, 0);

/** Còn chuyển được: việc đang mở và chưa đủ trần. */
export const canForward = (t: Pick<TaskDetail, "status" | "forwards">): boolean =>
  t.status === "open" && forwardsLeft(t.forwards) > 0;

/** Người được nhờ (không phải người đã nhờ): là `to` của một lần chuyển và chưa từng là `from`. */
export function forwardedToMe(forwards: readonly TaskForward[], myId: string): TaskForward | null {
  if (forwards.some((f) => f.from.id === myId)) return null;
  const mine = forwards.filter((f) => f.to.id === myId);
  return mine.length > 0 ? (mine[mine.length - 1] ?? null) : null;
}

/** Lần chuyển gần nhất do mình thực hiện (để hiện "↪ Đã nhờ … (chuyển k/3)"). */
export function lastForwardByMe(
  forwards: readonly TaskForward[],
  myId: string,
): { forward: TaskForward; k: number } | null {
  for (let i = forwards.length - 1; i >= 0; i--) {
    const f = forwards[i];
    if (f && f.from.id === myId) return { forward: f, k: i + 1 };
  }
  return null;
}

export type FieldError = { key: "answerRequired" } | { key: "tooLong"; max: number };

/** Câu trả lời 1..ANSWER_MAX sau trim. */
export function validateAnswer(text: string): FieldError | null {
  const s = text.trim();
  if (s.length === 0) return { key: "answerRequired" };
  if (s.length > ANSWER_MAX) return { key: "tooLong", max: ANSWER_MAX };
  return null;
}

export const validateNote = (note: string): FieldError | null =>
  note.trim().length > FORWARD_NOTE_MAX ? { key: "tooLong", max: FORWARD_NOTE_MAX } : null;

/** Mã lỗi API → khoá i18n (đầy đủ, gồm `process.`); mã lạ ⇒ `rtErr.unknown`. */
export function askErrorKey(code: string | undefined): string {
  switch (code) {
    case "FORWARD_TARGET_INVALID":
      return "process.ask.err.target";
    case "FORWARD_LIMIT":
      return "process.ask.err.limit";
    case "FORWARD_OUT_OF_GROUP":
      return "process.ask.err.group";
    case "REVIEW_TASK_CLOSED":
      return "process.ask.err.closed";
    case "TASK_KIND_MISMATCH":
      return "process.common.apiError.TASK_KIND_MISMATCH";
    default:
      return "rtErr.unknown";
  }
}

/** `HH:mm` địa phương của mốc ISO. */
export function hhmm(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
