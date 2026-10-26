// V2-E · CR-096 Q1 → CR-097a U1 (CHỈ ĐỌC; lớp 4 của gói): nối uy tín v2 — `PackUow` role `contracts_rw` (phạm vi người dùng) + repo + use case + route;
// vòng chốt tháng (`createRepLock`, `PackSystemUow` theo tenant) giữ làm hàm cho test nhưng KHÔNG còn chạy nền.
import type { Db } from "@ai/db";
import type { Hono } from "hono";
import { logger } from "../../../lib/logger";
import type { PackAccessView, PackGuardVars } from "../kit/adapters/pack-guard.middleware";
import { createPackUow, packTenantOnly } from "../kit/adapters/pack-uow";
import { repRepo } from "./adapters/rep.repo";
import { rowsOf } from "./adapters/rep.sql";
import { reputationRoutes } from "./adapters/reputation.routes";
import { createRepLockSweep, type RepLockSweep } from "./application/rep-lock-sweep";
import { reputationUsecase } from "./application/reputation.usecase";
import { reputationWriteUsecase } from "./application/reputation-write.usecase";
import { safeTimeZone } from "./reminders.mount";

export type { RepLockSweep };

const KEY = "contracts";

export type RepLockDeps = {
  timeZoneOf: (tenantId: string) => Promise<string>;
  tenants: () => Promise<readonly string[]>;
  now?: () => Date;
};

/** Vòng chốt tháng (test gọi thẳng `once`/`drain` với đồng hồ giả). */
export function createRepLock(db: Db, d: RepLockDeps): RepLockSweep {
  const uow = createPackUow(db, KEY, (tx, tid) => ({ rep: repRepo(tx, tid) }));
  return createRepLockSweep({
    uow: { system: (tid, fn) => uow.system(tid, fn) },
    tenants: d.tenants,
    timeZoneOf: safeTimeZone(d.timeZoneOf),
    now: d.now ?? (() => new Date()),
    log: logger,
  });
}

export function reputationModule(
  db: Db,
  view: PackAccessView,
  d: RepLockDeps & { worker?: boolean; everyMs?: number; signal?: AbortSignal },
): Hono<PackGuardVars> {
  // CR-097a (U1): uy tín v2 đóng băng ⇒ KHÔNG chạy vòng chốt tháng (`worker`/`everyMs`/`signal` giữ cho tương thích). Điểm hiện hành = HD8.
  const uow = packTenantOnly(createPackUow(db, KEY, (tx, t) => ({ rep: repRepo(tx, t) })));
  const deps = {
    uow,
    timeZoneOf: safeTimeZone(d.timeZoneOf),
    now: d.now ?? (() => new Date()),
    merge: rowsOf,
  };
  const uc = reputationUsecase(deps);
  return reputationRoutes(view, uc, reputationWriteUsecase(deps, uc));
}
