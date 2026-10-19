// HD7-FR-03…10 · HD7-FR-09 · HD7 plan §2–§4 (lớp 4 của gói): nối sổ thanh toán — `PackUow` (role `contracts_rw`, RLS tenant) + repo +
// use case + route; vòng quá hạn (`PackSystemUow` theo tenant) chỉ khi `worker`: `drain` chạy tới hết việc rồi mới trả ⇒ `startLoop`
// chỉ ngủ giữa các lượt (mặc định 1 giờ như `connectors/poll.py`). Múi tenant qua `safeTimeZone` của HD4 (không nhân bản).
import type { Db, Tx } from "@ai/db";
import type { Hono } from "hono";
import { logger } from "../../../lib/logger";
import { startLoop } from "../../../lib/loop";
import type { PackAccessView, PackGuardVars } from "../kit/adapters/pack-guard.middleware";
import { createPackUow, packTenantOnly } from "../kit/adapters/pack-uow";
import { ledgerRoutes } from "./adapters/ledger.routes";
import { ledgerReadRepo } from "./adapters/ledger-read.repo";
import { ledgerWriteRepo } from "./adapters/ledger-write.repo";
import { overdueRepo } from "./adapters/overdue.repo";
import { ledgerCommands, ledgerReads } from "./application/ledger.usecase";
import { createOverdueSweepUsecase, type OverdueSweep } from "./application/overdue-sweep";
import { safeTimeZone } from "./reminders.mount";

export type { OverdueSweep };

const KEY = "contracts";
export const OVERDUE_BATCH = 500;
const DEFAULT_EVERY_MS = 3_600_000;

const ledgerRepos = (tx: Tx, t: string) => ({
  ledger: { ...ledgerWriteRepo(tx, t), ...ledgerReadRepo(tx, t) },
});

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
  const deps = { uow, timeZoneOf: safeTimeZone(d.timeZoneOf), now: d.now ?? (() => new Date()) };
  return ledgerRoutes(view, { cmd: ledgerCommands(deps), reads: ledgerReads(deps) });
}
