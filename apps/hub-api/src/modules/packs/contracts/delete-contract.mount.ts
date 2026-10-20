// V2-M · nối "Xoá hợp đồng" (lớp 4 của gói): `PackUow` (role `contracts_rw`, RLS tenant + M1) + repo + use case + route, gắn dưới
// `/pack/contracts` ở `packs.mount.ts`. Múi giờ tenant qua `safeTimeZone` (ngày ghi dòng đảo kho); `now` để test tiêm.
import type { Db, Tx } from "@ai/db";
import type { Hono } from "hono";
import type { PackAccessView, PackGuardVars } from "../kit/adapters/pack-guard.middleware";
import { createPackUow, packTenantOnly } from "../kit/adapters/pack-uow";
import { deleteContractRepo } from "./adapters/delete-contract.repo";
import { deleteContractRoutes } from "./adapters/delete-contract.routes";
import { deleteContractUsecases } from "./application/delete-contract.usecase";
import { safeTimeZone } from "./reminders.mount";

const KEY = "contracts";
const repos = (tx: Tx, t: string) => ({ deleteContract: deleteContractRepo(tx, t) });

export function deleteContractModule(
  db: Db,
  view: PackAccessView,
  d: { timeZoneOf: (tenantId: string) => Promise<string>; now?: () => Date },
): Hono<PackGuardVars> {
  return deleteContractRoutes(
    view,
    deleteContractUsecases({
      uow: packTenantOnly(createPackUow(db, KEY, repos)),
      timeZoneOf: safeTimeZone(d.timeZoneOf),
      now: d.now ?? (() => new Date()),
    }),
  );
}
