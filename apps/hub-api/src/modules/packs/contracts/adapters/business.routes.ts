// V2-J1 · SP-01/02/07 · CD-06: route điểm kinh doanh dưới `/pack/contracts/business`: `GET /products` (danh sách + điểm + đề xuất),
// `GET /products/:id` (tóm tắt + lịch sử mua bán), `GET /products/:id/contracts`, `GET /config` (quyền đọc), `PUT /config` (chỉ quản lý).
// Guard quyền gói TRƯỚC đọc thân (viewer ghi ⇒ 403); id sai dạng ⇒ 400; không có / tenant khác ⇒ 404; ngưỡng sai ⇒ 422 `BUSINESS_INVALID`.
import { BIZ_ERRORS, BizConfigSchema, BizListQuerySchema } from "@ai/contracts";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { AppError, appError } from "../../../../lib/errors";
import { parseQuery, parseWith, readJson } from "../../../../lib/http";
import {
  type PackAccessView,
  type PackGuardVars,
  packAccessInput,
  packGuard,
} from "../../kit/adapters/pack-guard.middleware";
import { checkPackAccess } from "../../kit/domain/pack-access.rules";
import { BizFail, type BusinessUsecase } from "../application/business.usecase";

const KEY = "contracts";
const P = "/business";
const who = (c: Context<PackGuardVars>) => {
  const u = c.get("user");
  return { tenantId: u.tenantId, userId: u.userId };
};
const run = <T>(p: Promise<T>): Promise<T> =>
  p.catch((e) => {
    if (!(e instanceof BizFail)) throw e;
    if (e.kind === "not_found") throw appError("NOT_FOUND");
    throw new AppError("BUSINESS_INVALID", BIZ_ERRORS.BUSINESS_INVALID, e.detail);
  });

export function businessRoutes(view: PackAccessView, uc: BusinessUsecase): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const read = packGuard(view, KEY, "read");
  const write = packGuard(view, KEY, "write");
  const admin = async (c: Context<PackGuardVars>) => {
    const i = await packAccessInput(view, KEY, c.get("user"));
    if (checkPackAccess({ ...i, grantedGroupIds: i.grantedByAction.admin }) !== "ok")
      throw new AppError("PACK_FORBIDDEN", 403, "Chỉ quản lý được chỉnh cách tính điểm kinh doanh");
  };
  const id = (c: Context<PackGuardVars>) => parseWith(z.uuid(), c.req.param("id"));

  r.get(`${P}/products`, read, async (c) =>
    c.json(await run(uc.list(who(c), parseQuery(c, BizListQuerySchema)))),
  );
  r.get(`${P}/products/:id`, read, async (c) => c.json(await run(uc.detail(who(c), id(c)))));
  r.get(`${P}/products/:id/contracts`, read, async (c) =>
    c.json({ items: await run(uc.contracts(who(c), id(c))) }),
  );
  r.get(`${P}/config`, read, async (c) => c.json(await uc.getConfig(who(c))));
  r.put(`${P}/config`, write, async (c) => {
    await admin(c);
    return c.json(await run(uc.saveConfig(who(c), parseWith(BizConfigSchema, await readJson(c)))));
  });
  return r;
}
