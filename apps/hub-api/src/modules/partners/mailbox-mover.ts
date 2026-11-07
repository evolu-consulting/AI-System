// CR-124 · q1 · spec §7 · FLOW4-FR-07/11 · NFR-02/03 · bộ chuyển hộp thư liên công ty. Một lượt (`partnerMoveOnce`) = MỘT tx
// scope system, 3 câu cố định (đặt scope + giao `sent` + phát `replied`), không phụ thuộc số dòng. Vòng nền chạy liền khi còn
// việc, hết việc nghỉ `idleMs` (Luật 4c). Bật bằng `HUB_PARTNER_MAILBOX=on` (mặc định tắt); test gọi `partnerMoveOnce`.
import type { Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { deliverSent, emitReplies } from "./adapters/mailbox-mover.repo";
import { PARTNER_MOVE_BATCH, PARTNER_MOVE_IDLE_MS } from "./domain/mailbox-events.rules";

export type PartnerMoverDeps = { db: Db; batch?: number };
export type PartnerMoveStats = {
  delivered: number;
  receivedEvents: number;
  replied: number;
  replyEvents: number;
};

const SYS = { kind: "system" as const };

export async function partnerMoveOnce(d: PartnerMoverDeps): Promise<PartnerMoveStats> {
  const n = d.batch ?? PARTNER_MOVE_BATCH;
  return withHubScope(d.db, SYS, async (tx) => {
    const s = await deliverSent(tx, n);
    const r = await emitReplies(tx, n);
    return {
      delivered: s.moved,
      receivedEvents: s.emitted,
      replied: r.moved,
      replyEvents: r.emitted,
    };
  });
}

export function startPartnerMover(
  d: PartnerMoverDeps & { log?: { warn(msg: string, f?: Record<string, unknown>): void } },
  o: { signal?: AbortSignal; idleMs?: number } = {},
): void {
  const idle = o.idleMs ?? PARTNER_MOVE_IDLE_MS;
  const n = d.batch ?? PARTNER_MOVE_BATCH;
  const loop = async () => {
    while (!o.signal?.aborted) {
      let busy = false;
      try {
        const s = await partnerMoveOnce(d);
        busy = s.delivered >= n || s.replied >= n; // lô đầy ⇒ còn việc, chạy tiếp ngay
      } catch (err) {
        d.log?.warn("partner-mover-failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      if (!busy) await new Promise((r) => setTimeout(r, idle));
    }
  };
  void loop();
}
