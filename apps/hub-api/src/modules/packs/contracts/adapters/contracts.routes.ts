// HD-FR-07 · HD-AC01 · HD-AC09 · D-03 · D-10 · D-13 · HD1 plan §2: route đọc gói hợp đồng (mount dưới `/pack/contracts`, sau
// `requireAuth`). Guard `read` TRƯỚC kiểm tham số (403 trước 400, 0 SQL). Query lặp (`?status=a&status=b`) ⇒ mảng; khoá phạm vi
// (`tenant_id`/`user_id`) bị bỏ — tenant/user chỉ từ token. `/contracts/facets` khai trước mọi `/contracts/:id` (T8).
import { ContractListQuerySchema } from "@ai/contracts";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { appError } from "../../../../lib/errors";
import { parseWith, readJson, withoutScopeKeys } from "../../../../lib/http";
import {
  type PackAccessView,
  type PackGuardVars,
  packGuard,
} from "../../kit/adapters/pack-guard.middleware";
import type { GetContract } from "../application/get-contract.usecase";
import type { GetFacets } from "../application/get-facets.usecase";
import type { GetFileLink } from "../application/get-file-link.usecase";
import type { GetSource } from "../application/get-source.usecase";
import type { ListContracts } from "../application/list-contracts.usecase";
import type { PatchFields } from "../application/patch-fields.usecase";
import type { ContractDetailDto, ContractFacetsDto, ContractListRowDto } from "./contracts.mapper";
import { patchBody, patchReply } from "./patch-fields.http";

export const CONTRACTS_KEY = "contracts";

export type ContractsReadUseCases = {
  list: ListContracts<ContractListRowDto>;
  facets: GetFacets<ContractFacetsDto>;
  detail: GetContract<ContractDetailDto>;
  source: GetSource;
  fileLink: GetFileLink;
  patchFields: PatchFields;
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

/** `:id` sai dạng ⇒ 400 `VALIDATION` (không lọt vào SQL). */
const idOf = (c: Context): string => parseWith(z.uuid(), c.req.param("id"));

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
  // T8 · HD-AC01: `:id` sai dạng ⇒ 400 trước SQL; id lạ / tenant khác ⇒ 404 `NOT_FOUND` giống hệt (không lộ tồn tại).
  r.get("/contracts/:id", read, async (c) => {
    const d = await uc.detail(whoOf(c.get("user")), idOf(c));
    if (!d) throw appError("NOT_FOUND");
    return c.json(d);
  });
  r.get("/contracts/:id/source", read, async (c) => {
    const s = await uc.source(whoOf(c.get("user")), idOf(c));
    if (s === null) throw appError("NOT_FOUND");
    return c.body(s, 200, { "content-type": "text/markdown; charset=utf-8" });
  });
  // 302 tới link FileBox ngắn hạn; không log URL, không phơi `file_id` (PK-FR-06). 404 ⇒ FileBox không bị gọi.
  r.get("/contracts/:id/file", read, async (c) => {
    const url = await uc.fileLink(whoOf(c.get("user")), idOf(c));
    if (!url) throw appError("NOT_FOUND");
    return c.redirect(url, 302);
  });
  // T9 · HD-AC06/07/09: guard `write` TRƯỚC đọc thân (viewer ⇒ 403, 0 SQL); id ⇒ thân ⇒ 400/422 trước SQL; tenant khác ⇒ 404.
  r.patch("/contracts/:id/fields", packGuard(view, CONTRACTS_KEY, "write"), async (c) => {
    const id = idOf(c);
    const input = patchBody(await readJson(c));
    return c.json(patchReply(await uc.patchFields(whoOf(c.get("user")), id, input)));
  });
  return r;
}
