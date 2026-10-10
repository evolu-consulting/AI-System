// CR-056 · P-a Bước 0: STUB PF2 — tin loại `ask` trong thread (câu hỏi + chip + `AskTaskCard` / `TaskWaitingNote`).
import type { ThreadMessageProps } from "../../shared/types";

export type AskMessageProps = ThreadMessageProps<"ask">;

export function AskMessage(_props: AskMessageProps) {
  return null;
}
