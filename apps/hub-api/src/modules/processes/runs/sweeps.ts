// HUB-FR-106 · D10 · D11 · PF1 · vòng quét: stage `queued` mồ côi (30 s), đối chiếu `interrupted` (60 s), hết hạn 7 ngày
// (plan §3.1, §4). Bước 0: lượt rỗng.
import type { SweepResult } from "../core/handles";
import type { ProcessDeps } from "../core/ports";

/** Seam `ProcessHandles.sweepOnce`. */
export async function sweepOnce(_d: Omit<ProcessDeps, "launcher">): Promise<SweepResult> {
  return { queued: 0, interrupted: 0, expired: 0 };
}
