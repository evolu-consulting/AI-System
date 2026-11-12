// CR-124 · q1/q3 · spec §7 · FLOW4-FR-07/11 · NFR-02/03 · bộ chuyển hộp thư liên công ty. Một lượt (`partnerMoveOnce`):
//  - KHÔNG có cổng gói (`port`): MỘT tx scope system, 3 câu cố định (q1) — giao `sent` ⇒ `contract.received` tham chiếu + phát `replied`.
//  - CÓ cổng gói Hợp đồng (q3): (1) tx system: tenant nhận còn việc (1 câu); (2) mỗi tenant nhận: gói mở tx scope tenant đó lấy lô + tạo HĐ nhận
//    + sự kiện (3 câu cố định mỗi tenant, không phụ thuộc số dòng); (3) tx system: nhận lô `replied` (1) → gói đóng lần gửi + bắn tín hiệu cho
//    node chờ (2 câu cố định mỗi tenant gửi + 1 `signalEvent` mỗi trả lời) → chốt lô + phát `partner.*` (1). Lỗi ở gói ⇒ rollback, lượt sau thử lại.
//    (4) CR-127 · P1 · phiên ký chung (cổng có `onSignSessions`): tx system 2 câu cố định mỗi lô (nhận + chốt), gói báo từng bên ở giữa.
// Vòng nền chạy liền khi còn việc, hết việc nghỉ `idleMs` (Luật 4c). Bật bằng `HUB_PARTNER_MAILBOX=on` (mặc định tắt); test gọi `partnerMoveOnce`.
import type { Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { PartnerMailboxPort } from "../packs/kit/public";
import {
  type ClaimedSession,
  claimReplies,
  claimSessions,
  deliverSent,
  emitReplies,
  finishReplies,
  finishSessions,
  pendingReceivers,
} from "./adapters/mailbox-mover.repo";
import { PARTNER_MOVE_BATCH, PARTNER_MOVE_IDLE_MS } from "./domain/mailbox-events.rules";

export type PartnerMoverDeps = {
  db: Db;
  batch?: number;
  /** q3 · cổng gói Hợp đồng, đọc MỖI lượt (gói đăng ký lúc mount). Vắng / trả undefined ⇒ đường q1. */
  port?: () => PartnerMailboxPort | undefined;
};
export type PartnerMoveStats = {
  delivered: number;
  receivedEvents: number;
  replied: number;
  replyEvents: number;
  /** CR-127 · P1 · phiên ký chung đã báo gói trong lượt. */
  sessions: number;
};

const SYS = { kind: "system" as const };

type SignSessionRow = Parameters<NonNullable<PartnerMailboxPort["onSignSessions"]>>[0][number];

/** Dòng hub ⇒ dòng gói; `proposed` (không có gì để báo) bỏ qua. */
const sessionRowOf = (x: ClaimedSession): SignSessionRow | null =>
  x.eff === "proposed"
    ? null
    : {
        sessionId: x.id,
        status: x.eff,
        expireChoice: x.expire_choice,
        fromTenant: x.from_tenant,
        toTenant: x.to_tenant,
        notifyFrom: x.notify_from,
        notifyTo: x.notify_to,
        cancelSide: x.cancel_side,
        cancelReason: x.cancel_reason,
      };

/**
 * CR-127 · P1 · pha phiên ký chung: MỘT tx system, 2 câu cố định mỗi lô (nhận lô SKIP LOCKED + chốt theo tập) — gói báo từng bên ở giữa
 * (tx scope tenant riêng). Gói ném ⇒ rollback, cờ giữ nguyên, lượt sau thử lại.
 */
async function moveSessions(d: PartnerMoverDeps, port: PartnerMailboxPort, n: number) {
  const on = port.onSignSessions;
  if (!on) return 0;
  return withHubScope(d.db, SYS, async (tx) => {
    const rows = await claimSessions(tx, n);
    if (rows.length === 0) return 0;
    const out = rows.map(sessionRowOf).filter((x): x is SignSessionRow => x !== null);
    if (out.length > 0) await on.call(port, out);
    await finishSessions(
      tx,
      rows.map((x) => ({ id: x.id, status: x.eff })),
    );
    return rows.length;
  });
}

async function moveWithPort(d: PartnerMoverDeps, port: PartnerMailboxPort, n: number) {
  const tenants = await withHubScope(d.db, SYS, (tx) => pendingReceivers(tx, n));
  let received = 0;
  for (const t of tenants) received += await port.receive(t, n);
  const r = await withHubScope(d.db, SYS, async (tx) => {
    const rows = await claimReplies(tx, n);
    if (rows.length === 0) return { moved: 0, emitted: 0 };
    await port.onReplies(
      rows.map((x) => ({
        mailboxId: x.id,
        tenantId: x.tenant_id,
        ref: x.ref,
        outcome: x.outcome,
        reason: x.reason,
        source: x.source,
        round: x.round,
      })),
    );
    return finishReplies(
      tx,
      rows.map((x) => x.id),
    );
  });
  const sessions = await moveSessions(d, port, n);
  return {
    delivered: received,
    receivedEvents: received,
    replied: r.moved,
    replyEvents: r.emitted,
    sessions,
  };
}

export async function partnerMoveOnce(d: PartnerMoverDeps): Promise<PartnerMoveStats> {
  const n = d.batch ?? PARTNER_MOVE_BATCH;
  const port = d.port?.();
  if (port) return moveWithPort(d, port, n);
  return withHubScope(d.db, SYS, async (tx) => {
    const s = await deliverSent(tx, n);
    const r = await emitReplies(tx, n);
    return {
      delivered: s.moved,
      receivedEvents: s.emitted,
      replied: r.moved,
      replyEvents: r.emitted,
      sessions: 0,
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
        busy = s.delivered >= n || s.replied >= n || s.sessions >= n; // lô đầy ⇒ còn việc, chạy tiếp ngay
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
