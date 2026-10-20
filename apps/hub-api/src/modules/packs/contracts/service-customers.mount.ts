// V2-H · nối "Khách đang dùng" + nhắc gia hạn + Cài đặt kinh doanh (lớp 4 của gói): `PackUow` (role `contracts_rw`, RLS tenant +
// luật thấy M1) + repo + use case + route, gắn dưới `/pack/contracts` ở `packs.mount.ts`. Múi tenant qua `safeTimeZone`; `now` để test tiêm.
import type { Db, Tx } from "@ai/db";
import type { Hono } from "hono";
import type { PackAccessView, PackGuardVars } from "../kit/adapters/pack-guard.middleware";
import { createPackUow, packTenantOnly } from "../kit/adapters/pack-uow";
import { serviceCustomersRepo } from "./adapters/service-customers.repo";
import { serviceCustomersRoutes } from "./adapters/service-customers.routes";
import { serviceCustomersUsecases } from "./application/service-customers.usecase";
import { safeTimeZone } from "./reminders.mount";

const KEY = "contracts";
const repos = (tx: Tx, t: string) => ({ serviceCustomers: serviceCustomersRepo(tx, t) });

export function serviceCustomersModule(
  db: Db,
  view: PackAccessView,
  d: { timeZoneOf: (tenantId: string) => Promise<string>; now?: () => Date },
): Hono<PackGuardVars> {
  return serviceCustomersRoutes(
    view,
    serviceCustomersUsecases({
      uow: packTenantOnly(createPackUow(db, KEY, repos)),
      timeZoneOf: safeTimeZone(d.timeZoneOf),
      now: d.now ?? (() => new Date()),
    }),
  );
}
