// CR-152 · nối trường riêng + kỳ doanh thu / đối soát của Nhượng quyền / Hợp tác (lớp 4): `PackUow` (role `contracts_rw`, RLS tenant) + repo +
// use case + route, gắn dưới `/pack/contracts` ở `packs.mount.ts`.
import type { Db, Tx } from "@ai/db";
import type { Hono } from "hono";
import type { PackAccessView, PackGuardVars } from "../kit/public";
import { createPackUow, packTenantOnly } from "../kit/public";
import { kindTermsRepo } from "./adapters/kind-terms.repo";
import { kindTermsRoutes } from "./adapters/kind-terms.routes";
import { kindTermsUsecases } from "./application/kind-terms.usecase";

const repos = (tx: Tx, t: string) => ({ kindTerms: kindTermsRepo(tx, t) });

export function kindTermsModule(db: Db, view: PackAccessView): Hono<PackGuardVars> {
  return kindTermsRoutes(
    view,
    kindTermsUsecases({ uow: packTenantOnly(createPackUow(db, "contracts", repos)) }),
  );
}
