// HUB-FR-112 · PF3 · nhắc task sau `REMIND_AFTER_H` (vòng 5 phút, `dueReminder`; plan §4). Bước 0: lượt rỗng.
import type { ProcessDeps } from "../core/ports";

/** Seam `ProcessHandles.remindOnce`: số task vừa nhắc. */
export async function remindOnce(_d: ProcessDeps): Promise<number> {
  return 0;
}
