// HD8-FR-01…09 (lớp 4 của gói): nối đối tác / điểm uy tín / so giá hàng hoá / kiểm link báo giá / danh bạ công ty — `PackUow` role
// `contracts_rw` (chỉ phạm vi người dùng, D8-04) + repo + use case + route. Múi tenant qua `safeTimeZone` của HD4; tra MST qua cổng
// `TaxRegistry` của HD2 (null ⇒ "chưa tra được").
import type { Db, Tx } from "@ai/db";
import { Hono } from "hono";
import type { PackAccessView, PackGuardVars } from "../kit/adapters/pack-guard.middleware";
import { createPackUow, packTenantOnly } from "../kit/adapters/pack-uow";
import { companiesRepo } from "./adapters/companies.repo";
import { companiesRoutes } from "./adapters/companies.routes";
import { createInspect } from "./adapters/link-check.http";
import { partnersRepo } from "./adapters/partners.repo";
import { partnersRoutes } from "./adapters/partners.routes";
import { companiesUsecase } from "./application/companies.usecase";
import type { TaxRegistry } from "./application/extraction.ports";
import { partnersUsecase } from "./application/partners.usecase";
import type { Inspect } from "./domain/link-check.rules";
import { safeTimeZone } from "./reminders.mount";

const KEY = "contracts";

export function partnersModule(
  db: Db,
  view: PackAccessView,
  d: {
    timeZoneOf: (tenantId: string) => Promise<string>;
    now?: () => Date;
    /** Test: trang giả thay mạng thật. */
    inspect?: Inspect;
    tax?: TaxRegistry | null;
  },
): Hono<PackGuardVars> {
  const uow = packTenantOnly(
    createPackUow(db, KEY, (tx: Tx, t: string) => ({
      partners: partnersRepo(tx, t),
      companies: companiesRepo(tx, t),
    })),
  );
  const uc = partnersUsecase({
    uow,
    timeZoneOf: safeTimeZone(d.timeZoneOf),
    now: d.now ?? (() => new Date()),
    inspect: d.inspect ?? createInspect(),
  });
  const r = new Hono<PackGuardVars>();
  r.route("/", partnersRoutes(view, uc));
  r.route("/", companiesRoutes(view, companiesUsecase({ uow, tax: d.tax ?? null })));
  return r;
}
