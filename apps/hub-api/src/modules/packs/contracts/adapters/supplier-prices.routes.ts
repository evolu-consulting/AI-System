// V2-J2 · SP-04/05/06: `GET /products/:id/suppliers` (quyền `read`); `POST /products/:id/suppliers/search` (AI tìm giá — thân
// `{}` strict: ra ngoài chỉ có tên SP lấy từ DB), `POST /products/:id/supplier-prices` (lưu kết quả), `DELETE
// /products/:id/supplier-prices/:priceId` (quyền `write`; người xem ⇒ 403 trước khi đọc thân). Id sai dạng ⇒ 400; không có / SP
// Giới thiệu ⇒ 404; AI chưa cấu hình ⇒ 503 `SEARCH_UNAVAILABLE`; hết trần token ⇒ 429 `SEARCH_CAP`; AI lỗi/sai dạng ⇒ 502.
import {
  SUPPLIER_PRICE_ERRORS,
  SupplierPricesSaveSchema,
  SupplierSearchSchema,
} from "@ai/contracts";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { AppError, appError } from "../../../../lib/errors";
import { parseWith, readJson } from "../../../../lib/http";
import {
  type PackAccessView,
  type PackGuardVars,
  packGuard,
} from "../../kit/adapters/pack-guard.middleware";
import { SupplierFail, type SuppliersUsecase } from "../application/supplier-prices.usecase";

const KEY = "contracts";
const who = (c: Context<PackGuardVars>) => {
  const u = c.get("user");
  return { tenantId: u.tenantId, userId: u.userId };
};
const id = (c: Context<PackGuardVars>, name: string) => parseWith(z.uuid(), c.req.param(name));

const MESSAGES = {
  unavailable: ["SEARCH_UNAVAILABLE", "Price search is not available"],
  cap: ["SEARCH_CAP", "Daily AI token cap reached"],
  failed: ["SEARCH_FAILED", "Price search failed"],
  month_cap: ["SCOUT_MONTHLY_CAP", "Monthly price-scout limit reached for this company"],
} as const;

const run = <T>(p: Promise<T>): Promise<T> =>
  p.catch((e) => {
    if (!(e instanceof SupplierFail)) throw e;
    if (e.kind === "not_found") throw appError("NOT_FOUND");
    const [code, msg] = MESSAGES[e.kind];
    throw new AppError(code, SUPPLIER_PRICE_ERRORS[code], msg);
  });

export function supplierPricesRoutes(
  view: PackAccessView,
  d: { suppliers: SuppliersUsecase },
): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const read = packGuard(view, KEY, "read");
  const write = packGuard(view, KEY, "write");
  r.get("/products/:id/suppliers", read, async (c) =>
    c.json(await run(d.suppliers.overview(who(c), id(c, "id")))),
  );
  r.post("/products/:id/suppliers/search", write, async (c) => {
    const pid = id(c, "id");
    parseWith(SupplierSearchSchema, await readJson(c));
    return c.json(await run(d.suppliers.search(who(c), pid)));
  });
  r.post("/products/:id/supplier-prices", write, async (c) => {
    const pid = id(c, "id");
    const body = parseWith(SupplierPricesSaveSchema, await readJson(c));
    return c.json(await run(d.suppliers.save(who(c), pid, body.items)), 201);
  });
  r.delete("/products/:id/supplier-prices/:priceId", write, async (c) => {
    await run(d.suppliers.remove(who(c), id(c, "id"), id(c, "priceId")));
    return c.body(null, 204);
  });
  return r;
}
