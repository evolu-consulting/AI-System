// CR-056 · P-a Bước 0: STUB PF1 — tin loại `task_result` (Đạt / Chưa đạt + góp ý / đã trả lời / quyết định).
import type { ThreadMessageProps } from "../../shared/types";

export type TaskResultMessageProps = ThreadMessageProps<"task_result">;

export function TaskResultMessage(_props: TaskResultMessageProps) {
  return null;
}
