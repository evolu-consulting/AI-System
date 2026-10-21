// V2-J2 · nối tab NCC & giá (lớp 4 của gói): `PackUow` (role `contracts_rw`, RLS tenant + luật thấy M1) + repo + use case + route,
// gắn dưới `/pack/contracts` ở `packs.mount.ts`. AI client chung + trần thao tác do `packs.mount.ts` tiêm (cùng bộ với trích HĐ);
// điểm uy tín NCC lấy từ bảng điểm V2-E (`reputation.mount.ts::supplierScores`).
// price-scout: "Tìm giá trên thị trường" = lượt dò bấm tay của `price-scout.mount.ts` (agent Hub), tiêm qua `scout`.
import type { Db } from "@ai/db";
import type { Hono } from "hono";
import type { PackAccessView, PackGuardVars } from "../kit/adapters/pack-guard.middleware";
import { createPackUow } from "../kit/adapters/pack-uow";
import { suppliersRepo } from "./adapters/supplier-prices.repo";
import { supplierPricesRoutes } from "./adapters/supplier-prices.routes";
import { suppliersUsecase } from "./application/supplier-prices.usecase";

const KEY = "contracts";

export type SupplierPricesDeps = {
  scout: Parameters<typeof suppliersUsecase>[0]["scout"];
  reputation: Parameters<typeof suppliersUsecase>[0]["reputation"];
  timeZoneOf: (tenantId: string) => Promise<string>;
  now?: () => Date;
};

export function supplierPricesModule(
  db: Db,
  view: PackAccessView,
  d: SupplierPricesDeps,
): Hono<PackGuardVars> {
  const uow = createPackUow(db, KEY, (tx, t) => ({ suppliers: suppliersRepo(tx, t) }));
  return supplierPricesRoutes(view, { suppliers: suppliersUsecase({ uow, ...d }) });
}
