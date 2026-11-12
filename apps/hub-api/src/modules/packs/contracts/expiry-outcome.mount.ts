// CR-127 · SG1 · BR-68 · nối `POST /contracts/:id/expiry-outcome` + `can.expiry` của chi tiết HĐ: deps của `expiryCommands` (uow gói + "có quy trình
// `contract.expiring` khớp?" qua engine + vai owner ∪ trưởng phòng ∪ quản trị như `can.hold`). Dùng chung bởi `ledger.mount.ts` (route) và `contracts.mount.ts` (detail).
import type { Db } from "@ai/db";
import { createPackUow, flowEngine, packTenantOnly } from "../kit/public";
import { headOfOwner } from "./adapters/exec-head.repo";
import { execRequestsRepo } from "./adapters/exec-requests.repo";
import { expiryRepo } from "./adapters/expiring-outcome.repo";
import { EV_EXPIRING } from "./adapters/schedule-source.repo";
import { holdRoleOk } from "./application/exec-request.usecase";
import type { ExpiryDeps } from "./application/expiry-outcome.usecase";
import { CONTRACTS_PACK } from "./domain/contract-flow-events.rules";

export function expiryDepsOf(
  db: Db,
  d: {
    today: (tenantId: string) => Promise<string>;
    /** Quyền `admin` của gói (quản trị công ty) theo người gọi. */
    isAdmin: (who: { tenantId: string; userId: string }) => Promise<boolean>;
  },
): ExpiryDeps {
  const headOf = headOfOwner(db);
  return {
    uow: packTenantOnly(
      createPackUow(db, CONTRACTS_PACK, (tx, tid) => ({
        exec: execRequestsRepo(tx, tid),
        expiry: expiryRepo(tx, tid),
      })),
    ),
    hasFlow: async (q) =>
      (await flowEngine()?.availability.hasFlowFor(null, {
        tenantId: q.tenantId,
        app: CONTRACTS_PACK,
        event: EV_EXPIRING,
        facts: q.facts,
      })) ?? false,
    roleOk: (who, c) => holdRoleOk({ headOf, isAdmin: d.isAdmin }, who, c),
    today: d.today,
  };
}
