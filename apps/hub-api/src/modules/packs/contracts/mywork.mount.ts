// W1 · nối "Việc của tôi" (lớp 4 của gói): `PackUow` (role `contracts_rw`, RLS tenant + luật thấy M1) + repo + use case + route,
// gắn dưới `/pack/contracts` ở `packs.mount.ts`. Múi tenant qua `safeTimeZone` (HD4); `now` để test tiêm.
import type { Db, Tx } from "@ai/db";
import type { Hono } from "hono";
import type { PackAccessView, PackGuardVars } from "../kit/adapters/pack-guard.middleware";
import { createPackUow, packTenantOnly } from "../kit/adapters/pack-uow";
import { followupsRepo } from "./adapters/followups.repo";
import { myWorkRepo } from "./adapters/mywork.repo";
import { myWorkRoutes } from "./adapters/mywork.routes";
import { overviewRepo } from "./adapters/overview.repo";
import { overviewRoutes } from "./adapters/overview.routes";
import { todoRepo } from "./adapters/todo.repo";
import { followupsUsecases } from "./application/followups.usecase";
import { myWork } from "./application/mywork.usecase";
import { overviewUsecase } from "./application/overview.usecase";
import { safeTimeZone } from "./reminders.mount";

const KEY = "contracts";
const repos = (tx: Tx, t: string) => ({
  mywork: myWorkRepo(tx, t),
  followups: followupsRepo(tx, t),
  overview: overviewRepo(tx, t),
  todo: todoRepo(tx, t),
});

export function myWorkModule(
  db: Db,
  view: PackAccessView,
  d: { timeZoneOf: (tenantId: string) => Promise<string>; now?: () => Date },
): Hono<PackGuardVars> {
  const uow = packTenantOnly(createPackUow(db, KEY, repos));
  const tz = safeTimeZone(d.timeZoneOf);
  const now = d.now ?? (() => new Date());
  const r = myWorkRoutes(view, {
    followups: followupsUsecases({ uow, timeZoneOf: tz }),
    mywork: myWork({
      uow,
      timeZoneOf: safeTimeZone(d.timeZoneOf),
      now,
    }),
  });
  // V2-K · Tổng quan + Cần xử lý 8 nguồn (cùng PackUow).
  r.route("/", overviewRoutes(view, overviewUsecase({ uow, timeZoneOf: tz, now })));
  return r;
}
