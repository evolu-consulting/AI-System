// HD-FR-91…96 · HD9 plan §3 · lớp 4 của lát CKS: `PackUow` (role `contracts_rw`, RLS tenant) + repo + use case + route. Gắn dưới
// `/pack/contracts` ở `packs.mount.ts`. Đồng hồ/múi giờ tenant (BR-6) + sinh id + sha256 tiêm từ ngoài (test thay được).
import type { Db, Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { Hono } from "hono";
import type { PackAccessView, PackGuardVars } from "../../kit/adapters/pack-guard.middleware";
import { createPackUow, packTenantOnly } from "../../kit/adapters/pack-uow";
import { cksRoutes } from "./adapters/cks.routes";
import { cksReadRepo } from "./adapters/cks-read.repo";
import { cachedFlag } from "./adapters/cks-read-only";
import { cksWriteRepo } from "./adapters/cks-write.repo";
import type { CksClock } from "./application/ports";
import { cksReads } from "./application/read.usecase";
import { cksRenewals } from "./application/renewal.usecase";
import { cksSales } from "./application/sale.usecase";
import { cksSigned } from "./application/signed.usecase";

const cksRepos = (tx: Tx, t: string) => ({
  cks: { ...cksReadRepo(tx, t), ...cksWriteRepo(tx, t) },
});

const sha256 = (b: Uint8Array): string => new Bun.CryptoHasher("sha256").update(b).digest("hex");

export function cksModule(
  db: Db,
  view: PackAccessView,
  d: { timeZoneOf: (tenantId: string) => Promise<string>; now?: () => Date },
): Hono<PackGuardVars> {
  const uow = packTenantOnly(createPackUow(db, "contracts", cksRepos));
  const clock: CksClock = {
    now: d.now ?? (() => new Date()),
    timeZoneOf: d.timeZoneOf,
    newId: () => crypto.randomUUID(),
  };
  // V2-H (Q4): cờ ghi CKS theo tenant, một tx đọc khi nguội (đọc chỉ cần `app.tenant_id`, không user).
  const flagUow = createPackUow(db, "contracts", (tx: Tx) => ({
    writable: async () =>
      (await tx.execute<{ w: boolean }>(sql`select contracts.cks_writable() as w`))[0]?.w === true,
  }));
  const writable = cachedFlag(
    (tenantId) => flagUow.system(tenantId, (r) => r.writable()),
    () => Date.now(),
  );
  return cksRoutes(view, {
    reads: cksReads({ uow, clock }),
    sales: cksSales({ uow, clock }),
    renewals: cksRenewals({ uow, clock }),
    upload: cksSigned({ uow, sha256 }),
    writable,
  });
}
