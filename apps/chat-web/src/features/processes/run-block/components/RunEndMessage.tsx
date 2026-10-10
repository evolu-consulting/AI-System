// CR-056 · P-a Bước 0: STUB PF1 — tin loại `run_end` (Hoàn tất / Huỷ / Lỗi / Hết hạn + link trang lượt chạy).
import type { ThreadMessageProps } from "../../shared/types";

export type RunEndMessageProps = ThreadMessageProps<"run_end">;

export function RunEndMessage(_props: RunEndMessageProps) {
  return null;
}
