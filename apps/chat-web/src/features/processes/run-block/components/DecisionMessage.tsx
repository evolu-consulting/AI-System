// CR-056 · P-a Bước 0: STUB PF1 — tin loại `decision` ("Quy trình dừng ở giai đoạn …" + `DecisionCard`).
import type { ThreadMessageProps } from "../../shared/types";

export type DecisionMessageProps = ThreadMessageProps<"decision">;

export function DecisionMessage(_props: DecisionMessageProps) {
  return null;
}
