// CR-097 G1 · nối Giao dịch (lớp 4 của gói): `PackUow` (role `contracts_rw`, RLS tenant + luật thấy M1) + repo + use case + route,
// gắn dưới `/pack/contracts` ở `packs.mount.ts`. Múi giờ tenant cho "hôm nay" (chặn ngày tương lai, ngày đảo kho); `now` để test tiêm.
import type { Db, Tx } from "@ai/db";
import type { Hono } from "hono";
import type { PackAccessView, PackGuardVars } from "../kit/adapters/pack-guard.middleware";
import { createPackUow } from "../kit/adapters/pack-uow";
import { transactionsRepo } from "./adapters/transactions.repo";
import { transactionsRoutes } from "./adapters/transactions.routes";
import { transactionsUsecase } from "./application/transactions.usecase";
import { safeTimeZone } from "./reminders.mount";

const KEY = "contracts";
const repos = (tx: Tx, t: string) => ({ transactions: transactionsRepo(tx, t) });

export function transactionsModule(
  db: Db,
  view: PackAccessView,
  d: { timeZoneOf: (tenantId: string) => Promise<string>; now?: () => Date },
): Hono<PackGuardVars> {
  return transactionsRoutes(view, {
    transactions: transactionsUsecase({
      uow: createPackUow(db, KEY, repos),
      timeZoneOf: safeTimeZone(d.timeZoneOf),
      ...(d.now ? { now: d.now } : {}),
    }),
  });
}
