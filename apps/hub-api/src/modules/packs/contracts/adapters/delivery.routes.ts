// V2-D · BA §5.7a/b/e: `GET /milestones/:id/delivery` (bảng Trên HĐ · Đã giao · Giao lần này) và `POST /stock/check` (cảnh báo bán
// vượt tồn khi lưu HĐ bán — không chặn, không ghi). Guard `read` trước đọc thân; tenant khác / SP lạ ⇒ 404. `deliveryError` dùng chung
// cho xác nhận mốc (ledger) và lưu mốc (milestones).
import { DELIVERY_ERRORS, type DeliveryErrorCode, StockCheckRequestSchema } from "@ai/contracts";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { AppError, appError } from "../../../../lib/errors";
import { parseWith, readJson } from "../../../../lib/http";
import {
  type PackAccessView,
  type PackGuardVars,
  packGuard,
} from "../../kit/adapters/pack-guard.middleware";
import { DeliveryFail } from "../application/delivery.ports";
import type { DeliveryReads } from "../application/delivery.usecase";

const CODE: Record<Exclude<DeliveryFail["kind"], "not_found">, DeliveryErrorCode> = {
  over: "DELIVERY_OVER",
  invalid: "DELIVERY_INVALID",
  insufficient: "STOCK_INSUFFICIENT",
  locked: "DELIVERY_LOCKED",
};
const LOCKED = "Mốc giao đã ghi kho, không huỷ xác nhận được";

/** `DeliveryFail` ⇒ lỗi HTTP (message tiếng Việt nêu dòng/thành phần; thiếu tồn kèm `details.shortages`). */
export function deliveryError(e: DeliveryFail): never {
  if (e.kind === "not_found") throw appError("NOT_FOUND");
  const code = CODE[e.kind];
  const msg = e.kind === "locked" ? LOCKED : e.detail;
  throw new AppError(
    code,
    DELIVERY_ERRORS[code],
    msg,
    e.kind === "insufficient" ? { shortages: e.shortages } : undefined,
  );
}
const run = <T>(p: Promise<T>): Promise<T> =>
  p.catch((e) => {
    if (e instanceof DeliveryFail) deliveryError(e);
    throw e;
  });
const who = (c: Context<PackGuardVars>) => {
  const u = c.get("user");
  return { tenantId: u.tenantId, userId: u.userId };
};

export function deliveryRoutes(view: PackAccessView, reads: DeliveryReads): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const read = packGuard(view, "contracts", "read");
  r.get("/milestones/:id/delivery", read, async (c) => {
    const id = parseWith(z.uuid(), c.req.param("id"));
    return c.json(await run(reads.view(who(c), id)));
  });
  r.post("/stock/check", read, async (c) => {
    const b = parseWith(StockCheckRequestSchema, await readJson(c));
    return c.json(await run(reads.stockCheck(who(c), b)));
  });
  return r;
}
