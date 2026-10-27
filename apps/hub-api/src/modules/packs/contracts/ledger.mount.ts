// HD7-FR-03…10 · HD7-FR-09 · HD7 plan §2–§4 (lớp 4 của gói): nối sổ thanh toán — `PackUow` (role `contracts_rw`, RLS tenant) + repo +
// use case + route; vòng quá hạn (`PackSystemUow` theo tenant) chỉ khi `worker`: `drain` chạy tới hết việc rồi mới trả ⇒ `startLoop`
// chỉ ngủ giữa các lượt (mặc định 1 giờ như `connectors/poll.py`). Múi tenant qua `safeTimeZone` của HD4 (không nhân bản).
import type { Db, Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { Hono } from "hono";
import { logger } from "../../../lib/logger";
import { startLoop } from "../../../lib/loop";
import type { PackAccessView, PackGuardVars } from "../kit/adapters/pack-guard.middleware";
import { createPackUow, packTenantOnly } from "../kit/adapters/pack-uow";
import { deliveryRepo } from "./adapters/delivery.repo";
import { deliveryRoutes } from "./adapters/delivery.routes";
import { ledgerRoutes } from "./adapters/ledger.routes";
import { ledgerReadRepo } from "./adapters/ledger-read.repo";
import { ledgerWriteRepo } from "./adapters/ledger-write.repo";
import { milestonesRepo } from "./adapters/milestones.repo";
import { milestonesRoutes } from "./adapters/milestones.routes";
import { obligationImpactRoutes } from "./adapters/obligation-impact.routes";
import { overdueRepo } from "./adapters/overdue.repo";
import { repRepo } from "./adapters/rep.repo";
import { rowsOf } from "./adapters/rep.sql";
import { deliveryReads } from "./application/delivery.usecase";
import type { LockedObligation } from "./application/ledger.ports";
import { ledgerCommands, ledgerReads } from "./application/ledger.usecase";
import { milestoneCommands } from "./application/milestones.usecase";
import { v2eDeltaIn } from "./application/obligation-impact.usecase";
import { createOverdueSweepUsecase, type OverdueSweep } from "./application/overdue-sweep";
import { localDate } from "./domain/local-time.rules";
import { obligationImpactOf } from "./obligation-impact.mount";
import { safeTimeZone } from "./reminders.mount";
import { envRepEngine } from "./rep-current.mount";

export type { OverdueSweep };

const KEY = "contracts";
export const OVERDUE_BATCH = 500;
const DEFAULT_EVERY_MS = 3_600_000;

export const ledgerRepos = (tx: Tx, t: string) => ({
  ledger: { ...ledgerWriteRepo(tx, t), ...ledgerReadRepo(tx, t) },
  milestones: milestonesRepo(tx, t), // V2-A · HD-11
  delivery: deliveryRepo(tx, t), // V2-D · HD-05 (mốc giao ⇒ kho)
  rep: repRepo(tx, t), // MS-impact · delta uy tín V2-E trong tx xác nhận
  /** MS-impact · Luật 4c: câu chấm V2-E lập kế hoạch ~25 ms; kế hoạch CHUNG (một lần mỗi kết nối) cho riêng đoạn chấm trong tx. */
  planGeneric: async (on: boolean) => {
    await tx.execute(
      sql`select set_config('plan_cache_mode', ${on ? "force_generic_plan" : "auto"}, true)`,
    );
  },
});
type TxRepos = ReturnType<typeof ledgerRepos>;
const deltaIn = v2eDeltaIn(rowsOf);

export type OverdueSweepDeps = {
  timeZoneOf: (tenantId: string) => Promise<string>;
  tenants: () => Promise<readonly string[]>;
  now?: () => Date;
  batchSize?: number;
};

/** Vòng quá hạn (test gọi trực tiếp `once`/`drain` với đồng hồ giả). */
export function createOverdueSweep(db: Db, d: OverdueSweepDeps): OverdueSweep {
  const uow = createPackUow(db, KEY, (tx, tid) => ({ overdue: overdueRepo(tx, tid) }));
  return createOverdueSweepUsecase({
    uow: { system: (tid, fn) => uow.system(tid, fn) },
    tenants: d.tenants,
    timeZoneOf: safeTimeZone(d.timeZoneOf),
    now: d.now ?? (() => new Date()),
    batchSize: d.batchSize ?? OVERDUE_BATCH,
    log: logger,
  });
}

/** Seam `PacksDeps.contractsOverdue`: `worker` ⇒ dựng vòng nền. */
export type ContractsOverdueDeps = { worker?: boolean; everyMs?: number };

export function ledgerModule(
  db: Db,
  view: PackAccessView,
  d: OverdueSweepDeps & ContractsOverdueDeps & { signal?: AbortSignal },
): Hono<PackGuardVars> {
  if (d.worker) {
    const s = createOverdueSweep(db, d);
    startLoop({
      name: "contracts-overdue",
      everyMs: d.everyMs ?? DEFAULT_EVERY_MS,
      tick: () => s.drain(),
      log: logger,
      ...(d.signal ? { signal: d.signal } : {}),
    });
  }
  const uow = packTenantOnly(createPackUow(db, KEY, ledgerRepos));
  const now = d.now ?? (() => new Date());
  // MS-impact: xem trước tác động + delta uy tín lưu trên dòng sổ khi xác nhận (engine hiện hành).
  const impact = obligationImpactOf(db, { timeZoneOf: d.timeZoneOf, now });
  const tz = safeTimeZone(d.timeZoneOf);
  const deps = {
    uow,
    timeZoneOf: tz,
    now,
    // Cờ `hd8` ⇒ không lưu (HD8 đọc cả tenant theo vai — phá ngưỡng V2-D); `v2e` ⇒ 4 câu trong tx, lọc một đối tác.
    repDelta: async (
      who: { tenantId: string },
      repos: unknown,
      q: { head: LockedObligation; at: string; fault: "partner" | "ours" | "unknown" | null },
    ) =>
      envRepEngine() === "v2e"
        ? deltaIn(repos as TxRepos, { ...q, today: localDate(now(), await tz(who.tenantId)) })
        : null,
  };
  const r = ledgerRoutes(view, {
    cmd: ledgerCommands(deps),
    reads: ledgerReads(deps),
    engine: envRepEngine, // REP-v3: cờ `v2e` ⇒ đóng chỉnh tay ±10
  });
  r.route("/", milestonesRoutes(view, milestoneCommands({ uow }))); // V2-A · thêm/sửa/xoá mốc
  r.route("/", deliveryRoutes(view, deliveryReads({ uow }))); // V2-D · bảng SL mốc giao + kiểm tồn
  r.route("/", obligationImpactRoutes(view, impact)); // MS-impact · xem trước tác động xác nhận mốc
  return r;
}
