// CR-101 DOC-model · nối gắn/gỡ chứng từ con của HĐ NT (lớp 4): `PackUow` (role `contracts_rw`, RLS tenant + M1) + repo + use case
// + route, gắn dưới `/pack/contracts` ở `packs.mount.ts`.
import type { Db, Tx } from "@ai/db";
import type { Hono } from "hono";
import type { PackAccessView, PackGuardVars } from "../kit/adapters/pack-guard.middleware";
import { createPackUow, packTenantOnly } from "../kit/adapters/pack-uow";
import { docFrameRepo } from "./adapters/doc-frame.repo";
import { docFrameRoutes } from "./adapters/doc-frame.routes";
import { docFrameUsecases } from "./application/doc-frame.usecase";

const repos = (tx: Tx, t: string) => ({ docFrame: docFrameRepo(tx, t) });

export function docFrameModule(db: Db, view: PackAccessView): Hono<PackGuardVars> {
  return docFrameRoutes(
    view,
    docFrameUsecases({ uow: packTenantOnly(createPackUow(db, "contracts", repos)) }),
  );
}
