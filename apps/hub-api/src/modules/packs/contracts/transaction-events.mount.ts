// CR-127 · X2 · spec §6 "Giao dịch gắn HĐ" · sự kiện `transaction.saved` (manifest: facts `deal_value`, `linked`; kết cục `approved|rejected`).
// Công ty có quy trình "Giao dịch lớn" khớp ⇒ giao dịch gắn mốc thành yêu cầu chờ duyệt (`exec_requests`, kho/công nợ CHƯA đổi); quy trình
// kết thúc `approved` ⇒ ghi vào mốc đúng đường `recordFulfillment` (cùng tx settle của engine, role gói); `rejected` / lượt huỷ / lỗi /
// không mở được ⇒ yêu cầu bị từ chối + báo người tạo (không bao giờ tự duyệt khi quy trình không chạy được). Đăng ký thay binding rỗng của
// `flow-unsourced-events.mount.ts` (tự rời danh sách khi có binding thật).
import type { Db, Tx } from "@ai/db";
import { withPackScope } from "@ai/db/pack-scope";
import { sql } from "drizzle-orm";
import {
  type FactsReader,
  type FlowRunEnd,
  moduleRegistry,
  type OutcomeHandler,
  type OutcomeInput,
  type OutcomeResult,
  withPackRoleInTx,
} from "../kit/public";
import {
  claimTxRequest,
  EV_TRANSACTION_SAVED,
  finishTxRequest,
  notifyTxRequester,
  readTxFacts,
  txRequestStatus,
} from "./adapters/transaction-flow.repo";
import { DeliveryFail } from "./application/delivery.ports";
import { LedgerFail } from "./application/ledger.ports";
import { type FulfillIn, fulfillInTx, type LedgerDeps } from "./application/ledger.usecase";
import { CONTRACTS_PACK } from "./domain/contract-flow-events.rules";
import { ledgerRepos } from "./ledger.mount";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SP = "x2_apply";

/** Repo gói trong tx engine (đã `withPackRoleInTx`): sổ + kho + `notify` (cùng SQL với `notifierFor` của kit). */
const repos = (tx: Tx, tid: string) => ({
  ...ledgerRepos(tx, tid),
  notify: {
    enqueue: async (rows: readonly unknown[]) => {
      if (rows.length === 0) return 0;
      const r = await tx.execute<{ n: number }>(
        sql`select notify.enqueue('contracts', ${JSON.stringify(rows)}::jsonb) as n`,
      );
      return Number(r[0]?.n ?? 0);
    },
  },
});

const reasonOf = (e: unknown): string | null => {
  if (e instanceof LedgerFail)
    return e.kind === "over_plan"
      ? "Vượt phần còn lại của mốc."
      : e.kind === "on_hold"
        ? "Hợp đồng đang tạm khoá."
        : e.kind === "change_pending"
          ? "Mốc đang có yêu cầu thay đổi chờ duyệt."
          : "Mốc không còn mở để ghi.";
  if (e instanceof DeliveryFail)
    return e.kind === "insufficient" ? e.message : "Số lượng giao không khớp phần còn lại của mốc.";
  return null;
};

/** Từ chối yêu cầu (CAS `pending`) + báo người tạo. Lặp lại / không có ⇒ không đổi gì. */
async function rejectTx(
  tx: Tx,
  tid: string,
  ref: string,
  from: "pending" | "approved",
  note: string,
): Promise<OutcomeResult> {
  const done = await finishTxRequest(tx, tid, ref, "rejected", from, note);
  if (done) {
    await notifyTxRequester(tx, done.requested_by, ref, "Giao dịch không được duyệt", note);
    return "applied";
  }
  return (await txRequestStatus(tx, tid, ref)) === null ? "not_found" : "already_applied";
}

async function approveTx(d: LedgerDeps, tx: Tx, tid: string, ref: string): Promise<OutcomeResult> {
  const req = await claimTxRequest(tx, tid, ref);
  if (!req) return (await txRequestStatus(tx, tid, ref)) === null ? "not_found" : "already_applied";
  // `hub.record_evidence` (bằng chứng của mốc) cần `app.user_id`: đặt người tạo giao dịch (loại scope giữ "system" — role gói không gọi được `packs.*`);
  // `withPackRoleInTx` trả lại giá trị cũ khi xong.
  await tx.execute(sql`select set_config('app.user_id', ${req.requested_by}, true)`);
  await tx.execute(sql.raw(`savepoint ${SP}`));
  try {
    await fulfillInTx(d)(
      repos(tx, tid) as never,
      { tenantId: tid, userId: req.requested_by },
      req.obligation_id,
      req.payload as FulfillIn,
    );
    await tx.execute(sql.raw(`release savepoint ${SP}`));
  } catch (e) {
    const why = reasonOf(e);
    if (why === null) throw e; // lỗi hạ tầng ⇒ engine rollback + thử lại
    await tx.execute(sql.raw(`rollback to savepoint ${SP}`));
    return rejectTx(tx, tid, ref, "approved", `Đã duyệt nhưng không ghi được vào mốc: ${why}`);
  }
  await finishTxRequest(tx, tid, ref, "applied", "approved", null);
  return "applied";
}

/** Facts HIỆN TẠI của yêu cầu (tự lọc tenant, chạy NGOÀI tx engine). */
export function transactionFactsReader(db: Db): FactsReader {
  return {
    packKey: CONTRACTS_PACK,
    events: [EV_TRANSACTION_SAVED],
    async read(tenantId, ref, keys) {
      if (!UUID.test(ref)) return null;
      const all = await withPackScope(
        db,
        { packKey: CONTRACTS_PACK, tenantId, userId: null },
        (tx) => readTxFacts(tx, tenantId, ref),
      );
      if (!all) return null;
      const out: Record<string, string | number | boolean | null> = {};
      for (const k of keys) if (k in all) out[k] = all[k] as string | number | boolean;
      return out;
    },
  };
}

export function transactionOutcomeHandler(d: LedgerDeps): OutcomeHandler<Tx> {
  const end = (why: string) => (tx: Tx, i: { tenantId: string; ref: string }) =>
    i.ref && UUID.test(i.ref)
      ? withPackRoleInTx(tx, CONTRACTS_PACK, i.tenantId, async () => {
          const r = await rejectTx(tx, i.tenantId, i.ref, "pending", why);
          return r === "applied";
        })
      : Promise.resolve(false);
  return {
    packKey: CONTRACTS_PACK,
    events: [EV_TRANSACTION_SAVED],
    async apply(tx: Tx, i: OutcomeInput) {
      if (!UUID.test(i.ref) || (i.outcome !== "approved" && i.outcome !== "rejected"))
        throw new Error(`contracts outcome chưa hỗ trợ: ${i.event} · ${i.outcome}`);
      return withPackRoleInTx(tx, CONTRACTS_PACK, i.tenantId, () =>
        i.outcome === "approved"
          ? approveTx(d, tx, i.tenantId, i.ref)
          : rejectTx(tx, i.tenantId, i.ref, "pending", "Giao dịch bị từ chối ở bước duyệt."),
      );
    },
    // Quy trình không chạy được ⇒ KHÔNG tự duyệt: từ chối kèm cách xử lý (người tạo lập lại giao dịch).
    notLaunched: (tx, i) =>
      end(
        "Không mở được quy trình duyệt giao dịch — nhờ quản trị kiểm tra quy trình rồi lập lại giao dịch.",
      )(tx, i),
    cancelled: (tx: Tx, i: FlowRunEnd) =>
      end("Quy trình duyệt giao dịch đã bị dừng — lập lại giao dịch.")(tx, i),
    failed: (tx: Tx, i: FlowRunEnd) =>
      end("Quy trình duyệt giao dịch bị lỗi — lập lại giao dịch.")(tx, i),
  };
}

/** Gọi MỘT lần lúc mount `transactionsModule`. Đăng ký lại ⇒ thay (vô hại). */
export function bindTransactionEvents(db: Db, d: LedgerDeps): void {
  moduleRegistry.bindEvent<Tx>({
    facts: transactionFactsReader(db),
    outcome: transactionOutcomeHandler(d),
  });
}
