// V2-B · nối danh mục SP (lớp 4 của gói): `PackUow` (role `contracts_rw`, RLS tenant + luật thấy M1) + repo + use case + route, gắn
// dưới `/pack/contracts` ở `packs.mount.ts`. Ghi kho (`applyDelivery`) không có route riêng — V2-D gọi trong tx xác nhận mốc giao.
import type { Db, Tx } from "@ai/db";
import { Hono } from "hono";
import type { PackAccessView, PackGuardVars } from "../kit/adapters/pack-guard.middleware";
import { createPackUow } from "../kit/adapters/pack-uow";
import { productExtrasRoutes } from "./adapters/product-extras.routes";
import { lotsRepo } from "./adapters/product-lots.repo";
import { sourcesRepo } from "./adapters/product-sources.repo";
import { productsRepo } from "./adapters/products.repo";
import { productsRoutes } from "./adapters/products.routes";
import { lotsUsecase } from "./application/product-lots.usecase";
import { sourcesUsecase } from "./application/product-sources.usecase";
import { productsUsecases } from "./application/products.usecase";
import { DEFAULT_TENANT_TZ } from "./domain/local-time.rules";
import { transactionsModule } from "./transactions.mount";

const KEY = "contracts";
const repos = (tx: Tx, t: string) => ({
  products: productsRepo(tx, t),
  sources: sourcesRepo(tx, t),
  lots: lotsRepo(tx, t),
});

/** gap-d1: `timeZoneOf` (ngày nhập lô mặc định theo múi tenant); vắng ⇒ múi mặc định. */
export function productsModule(
  db: Db,
  view: PackAccessView,
  d: { timeZoneOf?: (tenantId: string) => Promise<string>; now?: () => Date } = {},
): Hono<PackGuardVars> {
  const uow = createPackUow(db, KEY, repos);
  const r = new Hono<PackGuardVars>();
  r.route("/", productsRoutes(view, { products: productsUsecases({ uow }) }));
  r.route(
    "/",
    productExtrasRoutes(view, {
      sources: sourcesUsecase({ uow }),
      lots: lotsUsecase({
        uow,
        timeZoneOf: d.timeZoneOf ?? (async () => DEFAULT_TENANT_TZ),
        ...(d.now ? { now: d.now } : {}),
      }),
    }),
  );
  // CR-097 G1 · Giao dịch dùng danh mục SP + kho lô chung (intake Câu 7) ⇒ gắn cùng module SP (packs.mount.ts chạm trần 400 dòng).
  r.route(
    "/",
    transactionsModule(db, view, {
      timeZoneOf: d.timeZoneOf ?? (async () => DEFAULT_TENANT_TZ),
      ...(d.now ? { now: d.now } : {}),
    }),
  );
  return r;
}
