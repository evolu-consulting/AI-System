// V2-J1 · nối điểm kinh doanh SP (lớp 4 của gói): `PackUow` role `contracts_rw` (RLS tenant + luật thấy HĐ M1) + repo + use case + route,
// gắn dưới `/pack/contracts/business` ở `packs.mount.ts`.
import type { Db } from "@ai/db";
import type { Hono } from "hono";
import type { PackAccessView, PackGuardVars } from "../kit/adapters/pack-guard.middleware";
import { createPackUow, packTenantOnly } from "../kit/adapters/pack-uow";
import { businessRepo } from "./adapters/business.repo";
import { businessRoutes } from "./adapters/business.routes";
import { businessUsecase } from "./application/business.usecase";
import { safeTimeZone } from "./reminders.mount";

const KEY = "contracts";

export function businessModule(
  db: Db,
  view: PackAccessView,
  d: { timeZoneOf: (tenantId: string) => Promise<string>; now?: () => Date },
): Hono<PackGuardVars> {
  const uow = packTenantOnly(
    createPackUow(db, KEY, (tx, t) => ({ business: businessRepo(tx, t) })),
  );
  return businessRoutes(
    view,
    businessUsecase({
      uow,
      timeZoneOf: safeTimeZone(d.timeZoneOf),
      now: d.now ?? (() => new Date()),
    }),
  );
}
