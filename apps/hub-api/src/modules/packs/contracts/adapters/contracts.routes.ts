// HD-FR-07 · HD-AC01 · HD-AC09 · D-03 · D-10 · D-13 · HD1 plan §2: route đọc gói hợp đồng (mount dưới `/pack/contracts`, sau
// `requireAuth`). Guard `read` TRƯỚC kiểm tham số (403 trước 400, 0 SQL). Query lặp (`?status=a&status=b`) ⇒ mảng; khoá phạm vi
// (`tenant_id`/`user_id`) bị bỏ — tenant/user chỉ từ token. `/contracts/facets` khai trước mọi `/contracts/:id` (T8).
import { ContractExportQuerySchema, ContractListQuerySchema } from "@ai/contracts";
import type { Context } from "hono";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { AppError, appError } from "../../../../lib/errors";
import { parseWith, readJson, withoutScopeKeys } from "../../../../lib/http";
import {
  type PackAccessView,
  type PackGuardVars,
  packGuard,
} from "../../kit/adapters/pack-guard.middleware";
import type { ExportContracts } from "../application/export-contracts.usecase";
import type { GetContract } from "../application/get-contract.usecase";
import type { GetFacets } from "../application/get-facets.usecase";
import type { GetFileLink } from "../application/get-file-link.usecase";
import type { GetSource } from "../application/get-source.usecase";
import type { ListContracts } from "../application/list-contracts.usecase";
import type { PatchFields } from "../application/patch-fields.usecase";
import type { ContractDetailDto, ContractFacetsDto, ContractListRowDto } from "./contracts.mapper";
import { exportResponse } from "./export.http";
import { patchBody, patchReply } from "./patch-fields.http";

export const CONTRACTS_KEY = "contracts";

export type ContractsReadUseCases = {
  list: ListContracts<ContractListRowDto>;
  facets: GetFacets<ContractFacetsDto>;
  /** Gap #8: xuất danh sách (xlsx/csv). */
  export: ExportContracts;
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

/** Trần thân PATCH trường (review m-02). */
export const PATCH_BODY_MAX_BYTES = 256 * 1024;
const payloadTooLarge = () => new AppError("PAYLOAD_TOO_LARGE", 413, "Payload too large");

/** `/source` là văn bản từ DOCX người dùng tải lên: không cho trình duyệt đoán kiểu, không lưu đệm (review m-06). */
export const SOURCE_HEADERS = {
  "content-type": "text/markdown; charset=utf-8",
  "x-content-type-options": "nosniff",
  "cache-control": "no-store",
} as const;

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
  // Gap #8: khai trước `/contracts/:id`. Cùng guard `read` + tx RLS của người gọi; thân phản hồi là luồng tệp.
  r.get("/contracts/export", read, async (c) => {
    const { format, ...q } = parseWith(ContractExportQuerySchema, listQueryInput(c));
    return exportResponse(await uc.export(whoOf(c.get("user")), q), format);
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
    return c.body(s, 200, SOURCE_HEADERS);
  });
  // 302 tới link FileBox ngắn hạn; không log URL, không phơi `file_id` (PK-FR-06). 404 ⇒ FileBox không bị gọi.
  r.get("/contracts/:id/file", read, async (c) => {
    const url = await uc.fileLink(whoOf(c.get("user")), idOf(c));
    if (!url) throw appError("NOT_FOUND");
    return c.redirect(url, 302);
  });
  // HD2 #220: cùng link ngắn hạn nhưng trả JSON — trình duyệt mở tab mới không mang Bearer, nên S05 gọi API rồi mở `url`.
  r.get("/contracts/:id/file-link", read, async (c) => {
    const url = await uc.fileLink(whoOf(c.get("user")), idOf(c));
    if (!url) throw appError("NOT_FOUND");
    c.header("cache-control", "no-store");
    return c.json({ url });
  });
  // T9 · HD-AC06/07/09: guard `write` TRƯỚC đọc thân (viewer ⇒ 403, 0 SQL); id ⇒ thân ⇒ 400/422 trước SQL; tenant khác ⇒ 404.
  // Thân > 256 KiB ⇒ 413 `PAYLOAD_TOO_LARGE` khi đọc (thân hợp lệ tối đa ≈ 23 × 2.000 ký tự < 200 KiB; review m-02).
  r.patch(
    "/contracts/:id/fields",
    packGuard(view, CONTRACTS_KEY, "write"),
    bodyLimit({ maxSize: PATCH_BODY_MAX_BYTES, onError: () => Promise.reject(payloadTooLarge()) }),
    async (c) => {
      const id = idOf(c);
      const input = patchBody(await readJson(c));
      return c.json(patchReply(await uc.patchFields(whoOf(c.get("user")), id, input)));
    },
  );
  return r;
}
