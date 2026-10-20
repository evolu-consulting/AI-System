// V2-B · nối danh mục SP (lớp 4 của gói): `PackUow` (role `contracts_rw`, RLS tenant + luật thấy M1) + repo + use case + route, gắn
// dưới `/pack/contracts` ở `packs.mount.ts`. Ghi kho (`applyDelivery`) không có route riêng — V2-D gọi trong tx xác nhận mốc giao.
import type { Db, Tx } from "@ai/db";
import type { Hono } from "hono";
import type { PackAccessView, PackGuardVars } from "../kit/adapters/pack-guard.middleware";
import { createPackUow } from "../kit/adapters/pack-uow";
import { productsRepo } from "./adapters/products.repo";
import { productsRoutes } from "./adapters/products.routes";
import { productsUsecases } from "./application/products.usecase";

const KEY = "contracts";
const repos = (tx: Tx, t: string) => ({ products: productsRepo(tx, t) });

export function productsModule(db: Db, view: PackAccessView): Hono<PackGuardVars> {
  return productsRoutes(view, {
    products: productsUsecases({ uow: createPackUow(db, KEY, repos) }),
  });
}
