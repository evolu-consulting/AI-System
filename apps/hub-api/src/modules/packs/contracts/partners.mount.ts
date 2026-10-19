// HD8-FR-01…06 (lớp 4 của gói): nối đối tác / điểm uy tín / so giá hàng hoá — `PackUow` role `contracts_rw` (chỉ phạm vi người
// dùng, D8-04) + repo + use case + route. Múi tenant qua `safeTimeZone` của HD4.
import type { Db, Tx } from "@ai/db";
import type { Hono } from "hono";
import type { PackAccessView, PackGuardVars } from "../kit/adapters/pack-guard.middleware";
import { createPackUow, packTenantOnly } from "../kit/adapters/pack-uow";
import { partnersRepo } from "./adapters/partners.repo";
import { partnersRoutes } from "./adapters/partners.routes";
import { partnersUsecase } from "./application/partners.usecase";
import { safeTimeZone } from "./reminders.mount";

const KEY = "contracts";

export function partnersModule(
  db: Db,
  view: PackAccessView,
  d: { timeZoneOf: (tenantId: string) => Promise<string>; now?: () => Date },
): Hono<PackGuardVars> {
  const uow = packTenantOnly(
    createPackUow(db, KEY, (tx: Tx, t: string) => ({ partners: partnersRepo(tx, t) })),
  );
  const uc = partnersUsecase({
    uow,
    timeZoneOf: safeTimeZone(d.timeZoneOf),
    now: d.now ?? (() => new Date()),
  });
  return partnersRoutes(view, uc);
}
