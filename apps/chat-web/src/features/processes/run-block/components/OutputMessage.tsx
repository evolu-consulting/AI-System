// CR-056 · P-a Bước 0: STUB PF1 — tin loại `output` (kết quả + bước + thẻ kiểm). PF1 thay thân; giữ tên export + props.
import type { ThreadMessageProps } from "../../shared/types";

export type OutputMessageProps = ThreadMessageProps<"output">;

export function OutputMessage(_props: OutputMessageProps) {
  return null;
}
