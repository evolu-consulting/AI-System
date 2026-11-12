// CR-127 · X3 · spec §4, §12.5 business · sự kiện `fulfilment.change_requested` (manifest: facts `kind`, `postpone_days`, `waive_amount`; kết cục `approved|rejected`).
// Có quy trình khớp ⇒ yêu cầu `pending` (mốc/HĐ CHƯA đổi); quy trình kết thúc `approved` ⇒ áp đúng đường `applyKind` (cùng tx settle của engine, role gói);
// `rejected` / lượt huỷ / lỗi / không mở được ⇒ yêu cầu bị từ chối, dữ liệu giữ nguyên, báo người yêu cầu (không bao giờ tự duyệt khi quy trình không chạy được).
// Đăng ký thay binding rỗng của `flow-unsourced-events.mount.ts` (tự rời danh sách khi có binding thật). Khuôn của `transaction-events.mount.ts`.
import type { Db, Tx } from "@ai/db";
import { withPackScope } from "@ai/db/pack-scope";
import { sql } from "drizzle-orm";
import {
  createPackUow,
  type FactsReader,
  type FlowRunEnd,
  flowEngine,
  moduleRegistry,
  type OutcomeHandler,
  type OutcomeInput,
  type OutcomeResult,
  packTenantOnly,
  withPackRoleInTx,
} from "../kit/public";
import { headOfOwner } from "./adapters/exec-head.repo";
import { EV_CHANGE_REQUESTED, execRequestsRepo } from "./adapters/exec-requests.repo";
import { ledgerReadRepo } from "./adapters/ledger-read.repo";
import { ledgerWriteRepo } from "./adapters/ledger-write.repo";
import {
  applyKind,
  type ExecDeps,
  ExecFail,
  type ExecRepos,
} from "./application/exec-request.usecase";
import { LedgerFail } from "./application/ledger.ports";
import { CONTRACTS_PACK } from "./domain/contract-flow-events.rules";
import { localDate } from "./domain/local-time.rules";
import { safeTimeZone } from "./reminders.mount";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SP = "x3_apply";

const reposOf = (tx: Tx, tid: string): ExecRepos => ({
  exec: execRequestsRepo(tx, tid),
  ledger: { ...ledgerWriteRepo(tx, tid), ...ledgerReadRepo(tx, tid) },
});

const reasonOf = (e: unknown): string | null => {
  if (e instanceof LedgerFail)
    return e.kind === "postpone_date"
      ? "Hạn mới không còn sau hạn hiện tại của mốc."
      : "Mốc không còn mở để thay đổi.";
  if (e instanceof ExecFail)
    return e.kind === "hold_exists"
      ? "Hợp đồng đã đang tạm khoá."
      : e.kind === "hold_not_allowed"
        ? "Hợp đồng không còn hiệu lực hoặc đã bị thay thế."
        : e.kind === "not_held"
          ? "Hợp đồng không còn bị tạm khoá."
          : "Yêu cầu không còn áp dụng được cho mốc.";
  return null;
};

/** Dữ kiện HIỆN TẠI: loại + số ngày dời / số tiền miễn đã chốt ở payload lúc lập yêu cầu (tính `postpone_days` từ `was`). */
function factsFrom(
  kind: string,
  p: Record<string, unknown>,
): Record<string, string | number | boolean> {
  if (kind === "postpone") {
    const days = typeof p.days === "number" ? p.days : null;
    return { kind, ...(days === null ? {} : { postpone_days: days }) };
  }
  if (kind === "waive_penalty")
    return { kind: "waive", ...(typeof p.waive === "number" ? { waive_amount: p.waive } : {}) };
  return { kind: kind === "split" ? "split" : "hold" };
}

/** Từ chối yêu cầu (CAS) + báo người yêu cầu. Lặp lại / không có ⇒ không đổi gì. */
async function reject(
  r: ExecRepos,
  ref: string,
  from: "pending" | "approved",
  note: string,
): Promise<OutcomeResult> {
  const done = await r.exec.finish(ref, "rejected", from, note);
  if (done) {
    await r.exec.notify(done.requested_by, ref, "Yêu cầu thay đổi không được duyệt", note);
    return "applied";
  }
  return (await r.exec.status(ref)) === null ? "not_found" : "already_applied";
}

async function approve(
  tx: Tx,
  tid: string,
  ref: string,
  today: (tenantId: string) => Promise<string>,
): Promise<OutcomeResult> {
  const r = reposOf(tx, tid);
  const req = await r.exec.claim(ref);
  if (!req) return (await r.exec.status(ref)) === null ? "not_found" : "already_applied";
  // `hub.record_evidence`/nhật ký cần người thao tác: đặt người yêu cầu (loại scope giữ nguyên; `withPackRoleInTx` trả lại khi xong).
  await tx.execute(sql`select set_config('app.user_id', ${req.requested_by}, true)`);
  await tx.execute(sql.raw(`savepoint ${SP}`));
  try {
    await applyKind({
      repos: r,
      contractId: req.contract_id,
      obligationId: req.obligation_id,
      kind: req.kind,
      payload: req.payload,
      by: req.requested_by,
      evidenceId: req.evidence_id,
      today: await today(tid),
    });
    await tx.execute(sql.raw(`release savepoint ${SP}`));
  } catch (e) {
    const why = reasonOf(e);
    if (why === null) throw e; // lỗi hạ tầng ⇒ engine rollback + thử lại
    await tx.execute(sql.raw(`rollback to savepoint ${SP}`));
    return reject(r, ref, "approved", `Đã duyệt nhưng không áp dụng được: ${why}`);
  }
  await r.exec.finish(ref, "applied", "approved", null);
  return "applied";
}

export function execFactsReader(db: Db): FactsReader {
  return {
    packKey: CONTRACTS_PACK,
    events: [EV_CHANGE_REQUESTED],
    async read(tenantId, ref, keys) {
      if (!UUID.test(ref)) return null;
      const row = await withPackScope(
        db,
        { packKey: CONTRACTS_PACK, tenantId, userId: null },
        (tx) => execRequestsRepo(tx, tenantId).payloadOf(ref),
      );
      if (!row) return null;
      const all = factsFrom(row.kind, row.payload);
      const out: Record<string, string | number | boolean | null> = {};
      for (const k of keys) if (k in all) out[k] = all[k] as string | number | boolean;
      return out;
    },
  };
}

export function execOutcomeHandler(d: {
  today: (tenantId: string) => Promise<string>;
}): OutcomeHandler<Tx> {
  const end = (why: string) => (tx: Tx, i: { tenantId: string; ref: string }) =>
    i.ref && UUID.test(i.ref)
      ? withPackRoleInTx(
          tx,
          CONTRACTS_PACK,
          i.tenantId,
          async () => (await reject(reposOf(tx, i.tenantId), i.ref, "pending", why)) === "applied",
        )
      : Promise.resolve(false);
  return {
    packKey: CONTRACTS_PACK,
    events: [EV_CHANGE_REQUESTED],
    async apply(tx: Tx, i: OutcomeInput) {
      if (!UUID.test(i.ref) || (i.outcome !== "approved" && i.outcome !== "rejected"))
        throw new Error(`contracts outcome chưa hỗ trợ: ${i.event} · ${i.outcome}`);
      return withPackRoleInTx(tx, CONTRACTS_PACK, i.tenantId, () =>
        i.outcome === "approved"
          ? approve(tx, i.tenantId, i.ref, d.today)
          : reject(reposOf(tx, i.tenantId), i.ref, "pending", "Yêu cầu bị từ chối ở bước duyệt."),
      );
    },
    notLaunched: (tx, i) =>
      end(
        "Không mở được quy trình duyệt thay đổi — nhờ quản trị kiểm tra quy trình rồi gửi lại yêu cầu.",
      )(tx, i),
    cancelled: (tx: Tx, i: FlowRunEnd) =>
      end("Quy trình duyệt thay đổi đã bị dừng — gửi lại yêu cầu.")(tx, i),
    failed: (tx: Tx, i: FlowRunEnd) =>
      end("Quy trình duyệt thay đổi bị lỗi — gửi lại yêu cầu.")(tx, i),
  };
}

/** Gọi MỘT lần lúc mount `ledgerModule`. Đăng ký lại ⇒ thay (vô hại). */
export function bindExecRequestEvents(
  db: Db,
  d: { today: (tenantId: string) => Promise<string> },
): void {
  moduleRegistry.bindEvent<Tx>({ facts: execFactsReader(db), outcome: execOutcomeHandler(d) });
}

/** Deps của `execCommands` (route hold/release/change-requests + bọc PATCH/postpone mốc): uow gói + "có quy trình khớp?" (engine) + trưởng phòng (hub scope). */
export function execDepsOf(
  db: Db,
  d: { timeZoneOf: (tenantId: string) => Promise<string>; now: () => Date },
): ExecDeps {
  const tz = safeTimeZone(d.timeZoneOf);
  return {
    uow: packTenantOnly(createPackUow(db, CONTRACTS_PACK, reposOf)),
    hasFlow: async (q) =>
      (await flowEngine()?.availability.hasFlowFor(null, {
        tenantId: q.tenantId,
        app: CONTRACTS_PACK,
        event: EV_CHANGE_REQUESTED,
        facts: q.facts,
      })) ?? false,
    headOf: headOfOwner(db),
    today: async (tid) => localDate(d.now(), await tz(tid)),
    newId: () => Bun.randomUUIDv7(),
  };
}
