// V2-J2 · SP-04/05/06: `GET /products/:id/suppliers` (quyền `read`); `POST /products/:id/suppliers/search` (AI tìm giá — thân
// `{}` strict: ra ngoài chỉ có tên SP lấy từ DB), `POST /products/:id/supplier-prices` (lưu kết quả), `DELETE
// /products/:id/supplier-prices/:priceId` (quyền `write`; người xem ⇒ 403 trước khi đọc thân). Id sai dạng ⇒ 400; không có / SP
// Giới thiệu ⇒ 404; AI chưa cấu hình ⇒ 503 `SEARCH_UNAVAILABLE`; hết trần token ⇒ 429 `SEARCH_CAP`; AI lỗi/sai dạng ⇒ 502.
import {
  QUOTE_MAX_BYTES,
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
import type { QuoteReadUsecase } from "../application/quote-read.usecase";
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
  unsupported: ["QUOTE_UNSUPPORTED", "Quote file must be a PDF or a text file"],
  unreadable: ["QUOTE_UNREADABLE", "No text could be read from the quote file"],
  too_large: ["QUOTE_TOO_LARGE", "Quote file is too large"],
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
  d: { suppliers: SuppliersUsecase; quote: QuoteReadUsecase },
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
  // gap-d1 #21 · multipart `file` (PDF/văn bản ≤ 5 MiB); Content-Length vượt ⇒ 413 trước khi đọc thân.
  r.post("/products/:id/supplier-prices/read-quote", write, async (c) => {
    const pid = id(c, "id");
    const len = Number(c.req.header("content-length"));
    if (Number.isFinite(len) && len > QUOTE_MAX_BYTES + 64 * 1024)
      return c.json(await run(Promise.reject(new SupplierFail("too_large"))));
    const form = await c.req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof Blob)) throw appError("VALIDATION_ERROR");
    const bytes = file.size > QUOTE_MAX_BYTES ? null : new Uint8Array(await file.arrayBuffer());
    if (!bytes) return c.json(await run(Promise.reject(new SupplierFail("too_large"))));
    return c.json(await run(d.quote.read(who(c), pid, bytes)));
  });
  r.delete("/products/:id/supplier-prices/:priceId", write, async (c) => {
    await run(d.suppliers.remove(who(c), id(c, "id"), id(c, "priceId")));
    return c.body(null, 204);
  });
  return r;
}
