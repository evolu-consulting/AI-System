// CR-056 · P-a Bước 0: STUB PF1 — khối quy trình ở timeline (`inThread`: đầu thread, không chân). PF1 thay thân; giữ chữ ký.
import type { ThreadMessageProps } from "../../shared/types";

export type ProcessBlockProps = ThreadMessageProps<"block"> & {
  /** Đầu thread: không chân `FlowRecent`/`FlowFooter`. */
  inThread?: boolean;
  /** Timeline: mở thread (`?flow=`). */
  onReply?: (flowId: string) => void;
};

export function ProcessBlock(_props: ProcessBlockProps) {
  return null;
}
