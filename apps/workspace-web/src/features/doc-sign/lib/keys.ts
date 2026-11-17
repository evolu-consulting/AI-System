// CR-181 · phím trên ô chữ ký + quyết định khi đóng màn ký (thuần để test không cần DOM).
import type { ArrowKey } from "./actions";

export type BoxKeyAction =
  | { type: "nudge"; key: ArrowKey }
  | { type: "delete" }
  | { type: "escape" }
  | null;

const ARROWS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];

export function boxKeyAction(key: string, editable: boolean): BoxKeyAction {
  if (!editable) return null;
  if (ARROWS.includes(key)) return { type: "nudge", key: key as ArrowKey };
  if (key === "Delete" || key === "Backspace") return { type: "delete" };
  if (key === "Escape") return { type: "escape" };
  return null;
}

/** Còn chữ ký chưa lưu ⇒ hỏi «Rời màn ký?» trước khi đóng. */
export const closeAction = (dirty: boolean): "confirm" | "close" => (dirty ? "confirm" : "close");
