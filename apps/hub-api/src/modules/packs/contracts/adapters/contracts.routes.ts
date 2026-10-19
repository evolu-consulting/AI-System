// HD-FR-07 · HD-AC01 · HD-AC09 · D-03 · D-10 · HD1 plan §2: route đọc gói hợp đồng (mount dưới `/pack/contracts`, sau
// `requireAuth`). Guard `read` TRƯỚC kiểm tham số (403 trước 400, 0 SQL). Query lặp (`?status=a&status=b`) ⇒ mảng; khoá phạm vi
// (`tenant_id`/`user_id`) bị bỏ — tenant/user chỉ từ token. `/contracts/facets` khai trước mọi `/contracts/:id` (T8).
import { ContractListQuerySchema } from "@ai/contracts";
import type { Context } from "hono";
import { Hono } from "hono";
import { parseWith, withoutScopeKeys } from "../../../../lib/http";
import {
  type PackAccessView,
  type PackGuardVars,
  packGuard,
} from "../../kit/adapters/pack-guard.middleware";
import type { GetFacets } from "../application/get-facets.usecase";
import type { ListContracts } from "../application/list-contracts.usecase";
import type { ContractFacetsDto, ContractListRowDto } from "./contracts.mapper";

export const CONTRACTS_KEY = "contracts";

export type ContractsReadUseCases = {
  list: ListContracts<ContractListRowDto>;
  facets: GetFacets<ContractFacetsDto>;
};

const REPEATED = new Set([
  "status",
  "owner",
  "category",
  "seller",
  "buyer",
  "signer",
  "direction",
  "kind",
]);

/** Query thô cho zod: khoá lặp ⇒ mọi giá trị, khoá đơn ⇒ giá trị đầu; bỏ `tenant_id`/`user_id`. */
export function listQueryInput(c: Context): Record<string, unknown> {
  const many = c.req.queries();
  return Object.fromEntries(
    Object.entries(withoutScopeKeys(c.req.query())).map(([k, v]) => [
      k,
      REPEATED.has(k) ? many[k] : v,
    ]),
  );
}

const whoOf = (u: { tenantId: string; userId: string }) => ({
  tenantId: u.tenantId,
  userId: u.userId,
});

export function contractsRoutes(
  view: PackAccessView,
  uc: ContractsReadUseCases,
): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const read = packGuard(view, CONTRACTS_KEY, "read");
  r.get("/contracts", read, async (c) => {
    const q = parseWith(ContractListQuerySchema, listQueryInput(c));
    return c.json(await uc.list(whoOf(c.get("user")), q));
  });
  r.get("/contracts/facets", read, async (c) => c.json(await uc.facets(whoOf(c.get("user")))));
  return r;
}
