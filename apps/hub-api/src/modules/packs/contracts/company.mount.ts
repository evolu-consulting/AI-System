// V2-L · CD-01 (lớp 4 của gói): nối cài đặt công ty — `PackUow` role `contracts_rw` (RLS tenant) + repo + use case + route, gắn dưới
// `/pack/contracts/company` ở `packs.mount.ts`.
import type { Db } from "@ai/db";
import type { Hono } from "hono";
import type { PackAccessView, PackGuardVars } from "../kit/adapters/pack-guard.middleware";
import { createPackUow, packTenantOnly } from "../kit/adapters/pack-uow";
import { companyRepo } from "./adapters/company.repo";
import { companyRoutes } from "./adapters/company.routes";
import { companyUsecase } from "./application/company.usecase";

const KEY = "contracts";

export function companyModule(db: Db, view: PackAccessView): Hono<PackGuardVars> {
  const uow = packTenantOnly(createPackUow(db, KEY, (tx, t) => ({ company: companyRepo(tx, t) })));
  return companyRoutes(view, companyUsecase({ uow }));
}
