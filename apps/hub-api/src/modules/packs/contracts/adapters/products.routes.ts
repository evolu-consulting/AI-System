// V2-B · danh mục SP: `GET /products` + `GET /products/:id` (quyền `read`); `POST /products`, `POST /products/match`,
// `POST /products/:id/rules`, `DELETE /products/:id/rules/:ruleId` (quyền `write`; người xem ⇒ 403 trước khi đọc thân). Id sai dạng
// ⇒ 400; không có / không thấy ⇒ 404; trùng tên SP / quy tắc ⇒ 409 `PRODUCT_EXISTS`; cách lấy hàng trái nhóm… ⇒ 422 `PRODUCT_INVALID`.
import {
  PRODUCT_ERRORS,
  ProductCreateSchema,
  ProductMatchSchema,
  ProductRuleCreateSchema,
  ProductsQuerySchema,
} from "@ai/contracts";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { AppError, appError } from "../../../../lib/errors";
import { parseQuery, parseWith, readJson } from "../../../../lib/http";
import {
  type PackAccessView,
  type PackGuardVars,
  packGuard,
} from "../../kit/adapters/pack-guard.middleware";
import { ProductFail, type ProductsUsecases } from "../application/products.usecase";

const KEY = "contracts";
const who = (c: Context<PackGuardVars>) => {
  const u = c.get("user");
  return { tenantId: u.tenantId, userId: u.userId };
};
const id = (c: Context<PackGuardVars>, name: string) => parseWith(z.uuid(), c.req.param(name));

const run = <T>(p: Promise<T>): Promise<T> =>
  p.catch((e) => {
    if (!(e instanceof ProductFail)) throw e;
    if (e.kind === "not_found") throw appError("NOT_FOUND");
    if (e.kind === "exists")
      throw new AppError(
        "PRODUCT_EXISTS",
        PRODUCT_ERRORS.PRODUCT_EXISTS,
        "Sản phẩm / quy tắc đã có",
      );
    throw new AppError("PRODUCT_INVALID", PRODUCT_ERRORS.PRODUCT_INVALID, e.message);
  });

export function productsRoutes(
  view: PackAccessView,
  d: { products: ProductsUsecases },
): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const read = packGuard(view, KEY, "read");
  const write = packGuard(view, KEY, "write");
  r.get("/products", read, async (c) =>
    c.json({ items: await d.products.list(who(c), parseQuery(c, ProductsQuerySchema)) }),
  );
  r.get("/products/:id", read, async (c) => c.json(await run(d.products.get(who(c), id(c, "id")))));
  r.post("/products", write, async (c) => {
    const body = parseWith(ProductCreateSchema, await readJson(c));
    return c.json(await run(d.products.create(who(c), body)), 201);
  });
  r.post("/products/match", write, async (c) => {
    const body = parseWith(ProductMatchSchema, await readJson(c));
    return c.json(await d.products.match(who(c), body));
  });
  r.post("/products/:id/rules", write, async (c) => {
    const pid = id(c, "id");
    const body = parseWith(ProductRuleCreateSchema, await readJson(c));
    return c.json(await run(d.products.addRule(who(c), pid, body)), 201);
  });
  r.delete("/products/:id/rules/:ruleId", write, async (c) => {
    await run(d.products.deleteRule(who(c), id(c, "id"), id(c, "ruleId")));
    return c.body(null, 204);
  });
  return r;
}
