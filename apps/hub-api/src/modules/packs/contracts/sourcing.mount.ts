// W1 · nối "Mua hàng" (lớp 4 của gói): `PackUow` (role `contracts_rw`, RLS tenant + luật thấy M1) + repo + use case + route, gắn dưới
// `/pack/contracts` ở `packs.mount.ts`. Múi tenant qua `safeTimeZone` (HD4) để ngày "đang áp dụng" là ngày lịch của tenant.
import type { Db, Tx } from "@ai/db";
import type { Hono } from "hono";
import type { PackAccessView, PackGuardVars } from "../kit/adapters/pack-guard.middleware";
import { createPackUow } from "../kit/adapters/pack-uow";
import { sourcingRepo } from "./adapters/sourcing.repo";
import { sourcingRoutes } from "./adapters/sourcing.routes";
import { sourcingUsecases } from "./application/sourcing.usecase";
import { safeTimeZone } from "./reminders.mount";

const KEY = "contracts";
const repos = (tx: Tx, t: string) => ({ sourcing: sourcingRepo(tx, t) });

export function sourcingModule(
  db: Db,
  view: PackAccessView,
  d: { timeZoneOf: (tenantId: string) => Promise<string>; now?: () => Date },
): Hono<PackGuardVars> {
  const uow = createPackUow(db, KEY, repos); // cả tenant (người dùng) lẫn hệ thống (dòng giá cả tenant cho bộ nhớ đệm)
  return sourcingRoutes(view, {
    sourcing: sourcingUsecases({
      uow,
      timeZoneOf: safeTimeZone(d.timeZoneOf),
      now: d.now ?? (() => new Date()),
    }),
  });
}
