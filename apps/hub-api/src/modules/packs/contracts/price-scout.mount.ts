// price-scout · nối dò giá thị trường (lớp 4 của gói): `PackUow` (role `contracts_rw`, RLS tenant) + repo + use case + route dưới
// `/pack/contracts`, agent Hub `price-scout` qua cổng nền `AgentCaller` (tiêm ở `packs.mount.ts`), và vòng dò theo lịch (chỉ khi
// `worker`): `drain` mỗi nhịp tới khi hết tenant có SP tới hạn; mỗi giờ tạo hàng lịch cho SP mới của nhóm có mặc định dò theo lịch.
// Env: `CONTRACTS_PRICE_SCOUT_MONTHLY` (trần lượt/tháng mặc định, 300), `CONTRACTS_PRICE_SCOUT_DAILY` (lượt theo lịch/tenant/ngày,
// 50), `CONTRACTS_PRICE_SCOUT_CONCURRENCY` (lượt đồng thời/tenant, 2), `CONTRACTS_PRICE_SCOUT_EVERY_MS` (nhịp, 60 s).
import type { Db } from "@ai/db";
import type { Hono } from "hono";
import type { AgentCaller } from "../../../lib/ai-client/agent-call";
import { logger } from "../../../lib/logger";
import { startLoop } from "../../../lib/loop";
import type { PackAccessView, PackGuardVars } from "../kit/adapters/pack-guard.middleware";
import { createPackUow } from "../kit/adapters/pack-uow";
import type { ActionQuota } from "./adapters/action-quota";
import { scoutAgent } from "./adapters/price-scout.agent";
import { scoutRepo } from "./adapters/price-scout.repo";
import { priceScoutRoutes } from "./adapters/price-scout.routes";
import { scoutDueFinder, scoutScheduleRepo } from "./adapters/price-scout-schedule.repo";
import type { ScheduleLimits } from "./application/price-scout.ports";
import { priceScoutUsecase, SCOUT_TIMEOUT_MS } from "./application/price-scout.usecase";
import { createScoutScheduler } from "./application/price-scout-schedule.usecase";
import { SCOUT_MONTHLY_DEFAULT } from "./domain/price-scout.rules";
import { safeTimeZone } from "./reminders.mount";

const KEY = "contracts";
const HOUR_MS = 3_600_000;

export type PriceScoutDeps = {
  agents: AgentCaller;
  quota: ActionQuota;
  timeZoneOf: (tenantId: string) => Promise<string>;
  /** Tenant có gói (cache, 0 SQL) — tập tạo hàng lịch mỗi giờ. */
  tenants: () => Promise<string[]>;
  worker?: boolean;
  everyMs?: number;
  signal?: AbortSignal;
  now?: () => Date;
};

const envInt = (k: string, def: number): number => {
  const n = Number(process.env[k]);
  return Number.isInteger(n) && n > 0 ? n : def;
};

export const scoutLimitsFromEnv = (): ScheduleLimits => ({
  concurrency: envInt("CONTRACTS_PRICE_SCOUT_CONCURRENCY", 2),
  daily: envInt("CONTRACTS_PRICE_SCOUT_DAILY", 50),
  systemSearches: envInt("CONTRACTS_PRICE_SCOUT_MONTHLY", SCOUT_MONTHLY_DEFAULT),
  leaseS: Math.ceil(SCOUT_TIMEOUT_MS / 1000) + 120,
});

/** Vòng dò theo lịch (test gọi `tenantOnce`/`drain` trực tiếp với đồng hồ giả). */
export function createPriceScoutScheduler(
  db: Db,
  d: PriceScoutDeps,
  limits = scoutLimitsFromEnv(),
) {
  const uow = createPackUow(db, KEY, (tx, tid) => ({ schedule: scoutScheduleRepo(tx, tid) }));
  return createScoutScheduler({
    finder: scoutDueFinder(db, KEY),
    uow: { system: (tid, fn) => uow.system(tid, fn) },
    agent: scoutAgent(d.agents),
    timeZoneOf: safeTimeZone(d.timeZoneOf),
    limits,
    now: d.now ?? (() => new Date()),
    timeoutMs: SCOUT_TIMEOUT_MS,
  });
}

function startScoutLoops(db: Db, d: PriceScoutDeps): void {
  const s = createPriceScoutScheduler(db, d);
  const sig = d.signal ? { signal: d.signal } : {};
  startLoop({
    name: "contracts-price-scout",
    everyMs: d.everyMs ?? 60_000,
    tick: () => s.drain(),
    log: logger,
    ...sig,
  });
  startLoop({
    name: "contracts-price-scout-sync",
    everyMs: HOUR_MS,
    tick: async () => {
      for (const tid of await d.tenants()) await s.materialize(tid);
    },
    log: logger,
    ...sig,
  });
}

export function priceScoutModule(db: Db, view: PackAccessView, d: PriceScoutDeps) {
  const uow = createPackUow(db, KEY, (tx, t) => ({ scout: scoutRepo(tx, t) }));
  const uc = priceScoutUsecase({
    uow,
    agent: scoutAgent(d.agents),
    quota: d.quota,
    timeZoneOf: d.timeZoneOf,
    systemSearches: scoutLimitsFromEnv().systemSearches,
    ...(d.now ? { now: d.now } : {}),
  });
  if (d.worker) startScoutLoops(db, d);
  const routes: Hono<PackGuardVars> = priceScoutRoutes(view, uc);
  return { routes, scout: uc.scout };
}
