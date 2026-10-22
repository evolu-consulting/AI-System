// V2-G · HD-02/HD-08 · §4.2 · C12: `POST /pack/contracts/contracts/:id/review` (Lưu màn xác nhận, 200) và
// `PUT /contracts/:id/items/:itemId/product` (gắn / gắn lại SP). Guard `write` TRƯỚC đọc thân/tham số (viewer ⇒ 403, 0 SQL); `:id`
// sai dạng ⇒ 400; thân strict; tenant khác ⇒ 404 như không có. Lỗi: 409 `CONTRACT_STALE` (version lệch), 409 `REVIEW_NOT_ALLOWED`
// (HĐ không còn chờ xác nhận), 422 `PRODUCT_INVALID` / `MILESTONE_INVALID` / `VALIDATION_ERROR` (hoa hồng sai loại, dòng lạ),
// 409 `ITEM_LOCKED` (dòng đã có phát sinh kho).
import {
  CONTRACT_ERRORS,
  ItemProductRequestSchema,
  MILESTONE_ERRORS,
  PRODUCT_ERRORS,
  PRODUCT_LINK_ERRORS,
  ProductLinksRequestSchema,
  ReviewSaveRequestSchema,
} from "@ai/contracts";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { AppError, appError } from "../../../../lib/errors";
import { parseWith, readJson } from "../../../../lib/http";
import {
  type PackAccessView,
  type PackGuardVars,
  packGuard,
} from "../../kit/adapters/pack-guard.middleware";
import type { LinkContractProducts } from "../application/product-links.usecase";
import type {
  AttachProduct,
  ReviewInput,
  ReviewResult,
  ReviewSave,
} from "../application/review.usecase";

const KEY = "contracts";
/** 500 dòng × ~700 byte + 23 trường × 2.000 + 200 mốc ≈ < 1 MiB. */
export const REVIEW_BODY_MAX_BYTES = 1024 * 1024;

/** `link` (products-confirm): `POST /contracts/:id/product-links` — gắn/tạo SP khi HĐ đã xác nhận. */
export type ReviewRoutesDeps = {
  save: ReviewSave;
  attach: AttachProduct;
  link?: LinkContractProducts;
};

const tooLarge = () => new AppError("PAYLOAD_TOO_LARGE", 413, "Payload too large");
const whoOf = (u: { tenantId: string; userId: string }) => ({
  tenantId: u.tenantId,
  userId: u.userId,
});
const productInvalid = () =>
  new AppError(
    "PRODUCT_INVALID",
    PRODUCT_ERRORS.PRODUCT_INVALID,
    "Sản phẩm / thành phần không có trong danh mục",
  );

/** FK kép `contract_items_product_fk` (23503) ⇒ 422 `PRODUCT_INVALID` (SP không có / của tenant khác). */
function productFail(e: unknown): never {
  const o = e as {
    code?: string;
    constraint_name?: string;
    cause?: { code?: string; constraint_name?: string };
  };
  const pg = o?.cause?.code ? o.cause : o;
  if (pg?.code === "23503" && pg.constraint_name === "contract_items_product_fk")
    throw productInvalid();
  throw e;
}

function replyOf(res: ReviewResult) {
  if (res.kind === "ok") return res.out;
  if (res.kind === "not_found") throw appError("NOT_FOUND");
  if (res.kind === "stale")
    throw new AppError("CONTRACT_STALE", CONTRACT_ERRORS.CONTRACT_STALE, "Contract was modified", {
      current: res.current,
      updated_at: res.updated_at,
    });
  if (res.kind === "not_reviewable")
    throw new AppError(
      "REVIEW_NOT_ALLOWED",
      CONTRACT_ERRORS.REVIEW_NOT_ALLOWED,
      "Contract is no longer waiting for confirmation",
    );
  if (res.kind === "milestone_invalid")
    throw new AppError(
      "MILESTONE_INVALID",
      MILESTONE_ERRORS.MILESTONE_INVALID,
      "Số tiền chỉ cho Thu tiền, Thanh toán, Nhận hoa hồng",
    );
  if (res.kind === "component_invalid") throw productInvalid();
  // `commission_kind` (hoa hồng chỉ cho Giới thiệu) · `item_unknown` (dòng không thuộc HĐ): lỗi dữ liệu gửi lên.
  throw new AppError("VALIDATION_ERROR", 422, res.kind);
}

export function reviewRoutes(view: PackAccessView, d: ReviewRoutesDeps): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const write = packGuard(view, KEY, "write");
  r.post(
    "/contracts/:id/review",
    write,
    bodyLimit({ maxSize: REVIEW_BODY_MAX_BYTES, onError: () => Promise.reject(tooLarge()) }),
    async (c) => {
      const id = parseWith(z.uuid(), c.req.param("id"));
      const body = parseWith(ReviewSaveRequestSchema, await readJson(c));
      const res = await d.save(whoOf(c.get("user")), id, body as ReviewInput).catch(productFail);
      return c.json(replyOf(res));
    },
  );
  r.put("/contracts/:id/items/:itemId/product", write, async (c) => {
    const id = parseWith(z.uuid(), c.req.param("id"));
    const itemId = parseWith(z.uuid(), c.req.param("itemId"));
    const body = parseWith(ItemProductRequestSchema, await readJson(c));
    const out = await d.attach(whoOf(c.get("user")), id, itemId, body).catch(productFail);
    if (out.kind === "ok") return c.json(out.item);
    if (out.kind === "not_found") throw appError("NOT_FOUND");
    if (out.kind === "locked")
      throw new AppError(
        "ITEM_LOCKED",
        CONTRACT_ERRORS.ITEM_LOCKED,
        "Dòng đã phát sinh kho, không đổi sản phẩm",
      );
    throw productInvalid();
  });
  const link = d.link;
  if (link)
    r.post("/contracts/:id/product-links", write, async (c) => {
      const id = parseWith(z.uuid(), c.req.param("id"));
      const body = parseWith(ProductLinksRequestSchema, await readJson(c));
      const out = await link(whoOf(c.get("user")), id, body.links).catch(productFail);
      if (out.kind === "ok") return c.json({ created: out.created, linked: out.linked });
      if (out.kind === "not_found") throw appError("NOT_FOUND");
      if (out.kind === "locked")
        throw new AppError(
          "ITEM_LOCKED",
          PRODUCT_LINK_ERRORS.ITEMS_LOCKED,
          "Hợp đồng đã phát sinh kho, không đổi sản phẩm",
        );
      throw new AppError(
        "CONTRACT_NOT_CONFIRMED",
        PRODUCT_LINK_ERRORS.CONTRACT_NOT_CONFIRMED,
        "Hợp đồng chưa xác nhận — chưa tạo/gắn sản phẩm",
      );
    });
  return r;
}
