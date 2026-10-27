// V2-E · CR-096 Q1 → CR-097a U1 → CR-101b REP-v3 (lớp 4 của gói): nối uy tín v2 — `PackUow` role `contracts_rw` (phạm vi người
// dùng) + repo + use case + route; vòng chốt tháng (`PackSystemUow` theo tenant) chỉ khi `worker`, và mỗi lượt chỉ chốt khi cờ
// `REPUTATION_ENGINE=v2e` (cờ tắt ⇒ lượt rỗng, 0 SQL). `drain` chạy hết việc rồi mới trả ⇒ `startLoop` chỉ ngủ giữa các lượt (mặc
// định 6 giờ; kỳ đã chốt không tính lại nên lượt thừa chỉ tốn một câu đọc mỗi tenant).
import type { Db } from "@ai/db";
import type { Hono } from "hono";
import { logger } from "../../../lib/logger";
import { startLoop } from "../../../lib/loop";
import type { PackAccessView, PackGuardVars } from "../kit/adapters/pack-guard.middleware";
import { createPackUow, packTenantOnly } from "../kit/adapters/pack-uow";
import { repRepo } from "./adapters/rep.repo";
import { rowsOf } from "./adapters/rep.sql";
import { reputationRoutes } from "./adapters/reputation.routes";
import { createRepLockSweep, type RepLockSweep } from "./application/rep-lock-sweep";
import { reputationUsecase } from "./application/reputation.usecase";
import { reputationWriteUsecase } from "./application/reputation-write.usecase";
import type { RepEngine } from "./domain/rep-current.rules";
import { safeTimeZone } from "./reminders.mount";
import { repCurrent } from "./rep-current.mount";

export type { RepLockSweep };

const KEY = "contracts";
const DEFAULT_EVERY_MS = 6 * 3_600_000;

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
  d: RepLockDeps & {
    worker?: boolean;
    everyMs?: number;
    signal?: AbortSignal;
    engine?: () => RepEngine;
  },
): Hono<PackGuardVars> {
  const cur = repCurrent(db, d);
  if (d.worker) {
    const s = createRepLock(db, d);
    startLoop({
      name: "contracts-rep-lock",
      everyMs: d.everyMs ?? DEFAULT_EVERY_MS,
      tick: async () => {
        if (cur.engine() === "v2e") await s.drain();
      },
      log: logger,
      ...(d.signal ? { signal: d.signal } : {}),
    });
  }
  const uow = packTenantOnly(createPackUow(db, KEY, (tx, t) => ({ rep: repRepo(tx, t) })));
  const deps = {
    uow,
    timeZoneOf: safeTimeZone(d.timeZoneOf),
    now: d.now ?? (() => new Date()),
    merge: rowsOf,
  };
  const uc = reputationUsecase(deps);
  return reputationRoutes(view, {
    uc,
    wr: reputationWriteUsecase(deps, uc),
    engine: cur.engine,
    switchPreview: cur.switchPreview,
  });
}
