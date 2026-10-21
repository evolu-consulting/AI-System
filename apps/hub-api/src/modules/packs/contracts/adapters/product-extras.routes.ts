// gap-d1 · route bổ sung của SP (quyền: `read` cho GET, `write` cho còn lại; người xem ⇒ 403 trước khi đọc thân):
//   #18 `POST /products/:id/lots` (nhập lô tay) · #19 `GET|POST /products/:id/sources`, `DELETE /products/:id/sources/:sourceId`.
// Id sai dạng ⇒ 400; không có / SP Giới thiệu (cách lấy hàng) ⇒ 404; trùng NCC ⇒ 409 `SOURCE_EXISTS`; nhập lô sai luật kho ⇒ 422
// `PRODUCT_INVALID`.
import {
  PRODUCT_ERRORS,
  PRODUCT_SOURCE_ERRORS,
  ProductLotCreateSchema,
  ProductSourceCreateSchema,
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
import { LotFail, type LotsUsecase } from "../application/product-lots.usecase";
import { SourceFail, type SourcesUsecase } from "../application/product-sources.usecase";

const KEY = "contracts";
const who = (c: Context<PackGuardVars>) => {
  const u = c.get("user");
  return { tenantId: u.tenantId, userId: u.userId };
};
const id = (c: Context<PackGuardVars>, name: string) => parseWith(z.uuid(), c.req.param(name));

const run = <T>(p: Promise<T>): Promise<T> =>
  p.catch((e) => {
    if (e instanceof SourceFail || e instanceof LotFail) {
      if (e.kind === "not_found") throw appError("NOT_FOUND");
      if (e instanceof SourceFail)
        throw new AppError(
          "SOURCE_EXISTS",
          PRODUCT_SOURCE_ERRORS.SOURCE_EXISTS,
          "Supplier already listed",
        );
      throw new AppError("PRODUCT_INVALID", PRODUCT_ERRORS.PRODUCT_INVALID, e.message);
    }
    throw e;
  });

export function productExtrasRoutes(
  view: PackAccessView,
  d: { sources: SourcesUsecase; lots: LotsUsecase },
): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const read = packGuard(view, KEY, "read");
  const write = packGuard(view, KEY, "write");
  r.post("/products/:id/lots", write, async (c) => {
    const pid = id(c, "id");
    const body = parseWith(ProductLotCreateSchema, await readJson(c));
    return c.json(await run(d.lots.add(who(c), pid, body)), 201);
  });
  r.get("/products/:id/sources", read, async (c) =>
    c.json(await run(d.sources.list(who(c), id(c, "id")))),
  );
  r.post("/products/:id/sources", write, async (c) => {
    const pid = id(c, "id");
    const body = parseWith(ProductSourceCreateSchema, await readJson(c));
    return c.json(await run(d.sources.add(who(c), pid, body)), 201);
  });
  r.delete("/products/:id/sources/:sourceId", write, async (c) => {
    await run(d.sources.remove(who(c), id(c, "id"), id(c, "sourceId")));
    return c.body(null, 204);
  });
  return r;
}
