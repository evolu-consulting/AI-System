// CR-056 · P-a Bước 0: STUB PF2 — tin loại `forward` (một dòng nhẹ "↪ A đã nhờ B …", khoá theo `task_kind`).
import type { ThreadMessageProps } from "../../shared/types";

export type ForwardMessageProps = ThreadMessageProps<"forward">;

export function ForwardMessage(_props: ForwardMessageProps) {
  return null;
}
