// W1 · nối "Việc của tôi" (lớp 4 của gói): `PackUow` (role `contracts_rw`, RLS tenant + luật thấy M1) + repo + use case + route,
// gắn dưới `/pack/contracts` ở `packs.mount.ts`. Múi tenant qua `safeTimeZone` (HD4); `now` để test tiêm.
import type { Db, Tx } from "@ai/db";
import type { Hono } from "hono";
import type { PackAccessView, PackGuardVars } from "../kit/adapters/pack-guard.middleware";
import { createPackUow, packTenantOnly } from "../kit/adapters/pack-uow";
import { followupsRepo } from "./adapters/followups.repo";
import { myWorkRepo } from "./adapters/mywork.repo";
import { myWorkRoutes } from "./adapters/mywork.routes";
import { followupsUsecases } from "./application/followups.usecase";
import { myWork } from "./application/mywork.usecase";
import { safeTimeZone } from "./reminders.mount";

const KEY = "contracts";
const repos = (tx: Tx, t: string) => ({
  mywork: myWorkRepo(tx, t),
  followups: followupsRepo(tx, t),
});

export function myWorkModule(
  db: Db,
  view: PackAccessView,
  d: { timeZoneOf: (tenantId: string) => Promise<string>; now?: () => Date },
): Hono<PackGuardVars> {
  const uow = packTenantOnly(createPackUow(db, KEY, repos));
  const tz = safeTimeZone(d.timeZoneOf);
  return myWorkRoutes(view, {
    followups: followupsUsecases({ uow, timeZoneOf: tz }),
    mywork: myWork({
      uow,
      timeZoneOf: safeTimeZone(d.timeZoneOf),
      now: d.now ?? (() => new Date()),
    }),
  });
}
