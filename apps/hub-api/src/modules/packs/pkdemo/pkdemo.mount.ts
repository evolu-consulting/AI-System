// PK-FR-09 · D-08 · N1 plan §9: nối gói `pkdemo` (lớp 4 của gói): `PackUow` (role `pkdemo_rw`) + use case + route. Id sinh
// UUIDv7 (tăng dần trong tiến trình ⇒ thứ tự dòng = thứ tự id). Chỉ mount ngoài production (`packs.mount.ts` quyết).
import type { Db } from "@ai/db";
import type { Hono } from "hono";
import type { PackAccessView, PackGuardVars } from "../kit/adapters/pack-guard.middleware";
import { createPackUow, packTenantOnly } from "../kit/adapters/pack-uow";
import { pkdemoRepos } from "./adapters/items.repo";
import { PKDEMO_KEY, pkdemoRoutes } from "./adapters/pkdemo.routes";
import { createItem } from "./application/create-item.usecase";
import { getItem } from "./application/get-item.usecase";

export { PKDEMO_KEY };

export function pkdemoModule(db: Db, view: PackAccessView): Hono<PackGuardVars> {
  const uow = packTenantOnly(createPackUow(db, PKDEMO_KEY, pkdemoRepos));
  const newId = () => Bun.randomUUIDv7();
  return pkdemoRoutes(view, { create: createItem({ uow, newId }), get: getItem({ uow }) });
}
