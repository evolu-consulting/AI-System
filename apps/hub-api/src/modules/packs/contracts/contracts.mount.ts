// HD-FR-07 · HD1 plan §2 §4 · N1 plan §9: nối gói `contracts` (lớp 4 của gói): `PackUow` (role `contracts_rw`) + use case +
// route. `packs.mount.ts` quyết có mount (`deps.packs.contracts`, vắng ⇒ bật) và gắn dưới `/pack/contracts`.
import type { Db } from "@ai/db";
import type { Hono } from "hono";
import type { PackAccessView, PackGuardVars } from "../kit/adapters/pack-guard.middleware";
import { createPackUow, packTenantOnly } from "../kit/adapters/pack-uow";
import { contractsRepos } from "./adapters/contracts.repo";
import { CONTRACTS_KEY, contractsRoutes } from "./adapters/contracts.routes";
import { getFacets } from "./application/get-facets.usecase";
import { listContracts } from "./application/list-contracts.usecase";

export { CONTRACTS_KEY };

export function contractsModule(db: Db, view: PackAccessView): Hono<PackGuardVars> {
  const uow = packTenantOnly(createPackUow(db, CONTRACTS_KEY, contractsRepos));
  const r = contractsRoutes(view, { list: listContracts({ uow }), facets: getFacets({ uow }) });
  // T10 (tải lên): `upload.mount.ts`, gắn ở `packs.mount.ts` (cần Redis + FileBox + múi tenant mà module này không nhận).
  return r;
}
