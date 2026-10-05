// HUB-FR-75 · H2c-R27–R29 · PL2, PL11, PL13 · dọn file (plan §5.8, plan-rules §4): một transaction `system` mỗi lượt.
// B0: chỉ chữ ký (thân ném `not implemented`) — B10.
import type { Db } from "../../lib/db";
import type { Logger } from "../../lib/logger";
import type { AttachmentStorage } from "./storage";

export type SweepDeps = { db: Db; storage: AttachmentStorage; now: Date; log?: Logger };
export type SweepResult = { expired: number; purged: number; orphans: number; skipped: boolean };

/** Một lượt: khoá thử toàn cục (bận ⇒ `skipped`) → đánh dấu `purged_at` → xoá nội dung → xoá hàng → mồ côi. */
export function sweepOnce(_d: SweepDeps): Promise<SweepResult> {
  throw new Error("not implemented: sweepOnce");
}

/** Vòng nền (`lib/loop.ts`) gọi `sweepOnce` với `new Date()` mỗi `everyMs`. */
export function startAttachmentSweeper(
  _d: Omit<SweepDeps, "now"> & { log: Logger; everyMs: number; signal?: AbortSignal },
): void {
  throw new Error("not implemented: startAttachmentSweeper");
}
