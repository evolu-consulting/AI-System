// price-scout · `GET|PUT /products/:id/price-scout` (cấu hình dò giá của SP: đọc `read`, ghi `write`), `GET|PUT
// /price-scout/defaults` (mặc định nhóm SP: ghi = quản lý `contracts-admin`), `GET|PUT /price-scout/quota` (trần lượt dò/tháng:
// ghi = quản lý; trường `platform_*` chỉ platform_admin). Guard gói TRƯỚC đọc thân (0 SQL khi bị chặn); thân sai ⇒ 400; SP không có /
// tenant khác / Giới thiệu ⇒ 404.
import {
  PriceScoutDefaultsPutSchema,
  PriceScoutOverrideSchema,
  PriceScoutQuotaSchema,
} from "@ai/contracts";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { AppError, appError } from "../../../../lib/errors";
import { parseWith, readJson } from "../../../../lib/http";
import {
  type PackAccessView,
  type PackGuardVars,
  packAccessInput,
  packGuard,
} from "../../kit/adapters/pack-guard.middleware";
import { checkPackAccess } from "../../kit/domain/pack-access.rules";
import { type PriceScoutUsecase, ScoutFail } from "../application/price-scout.usecase";

const KEY = "contracts";
const who = (c: Context<PackGuardVars>) => {
  const u = c.get("user");
  return { tenantId: u.tenantId, userId: u.userId };
};
const id = (c: Context<PackGuardVars>) => parseWith(z.uuid(), c.req.param("id"));
const run = <T>(p: Promise<T>): Promise<T> =>
  p.catch((e) => {
    if (e instanceof ScoutFail && e.kind === "not_found") throw appError("NOT_FOUND");
    throw e;
  });

/** Quản lý gói (nhóm `contracts-admin`) — như PUT /company. */
async function requireAdmin(view: PackAccessView, c: Context<PackGuardVars>) {
  const i = await packAccessInput(view, KEY, c.get("user"));
  if (checkPackAccess({ ...i, grantedGroupIds: i.grantedByAction.admin }) !== "ok")
    throw new AppError("PACK_FORBIDDEN", 403, "Chỉ quản lý được đổi cấu hình dò giá");
}

export function priceScoutRoutes(view: PackAccessView, uc: PriceScoutUsecase): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const read = packGuard(view, KEY, "read");
  const write = packGuard(view, KEY, "write");
  const platform = (c: Context<PackGuardVars>) => c.get("user").role === "platform_admin";

  r.get("/products/:id/price-scout", read, async (c) => c.json(await run(uc.get(who(c), id(c)))));
  r.put("/products/:id/price-scout", write, async (c) => {
    const pid = id(c);
    const body = parseWith(PriceScoutOverrideSchema, await readJson(c));
    return c.json(await run(uc.save(who(c), pid, body)));
  });
  r.get("/price-scout/defaults", read, async (c) => c.json(await uc.defaults(who(c))));
  r.put("/price-scout/defaults", write, async (c) => {
    await requireAdmin(view, c);
    const body = parseWith(PriceScoutDefaultsPutSchema, await readJson(c));
    return c.json(await uc.saveDefaults(who(c), body.group, body.config));
  });
  r.get("/price-scout/quota", read, async (c) => c.json(await uc.quota(who(c), platform(c))));
  r.put("/price-scout/quota", write, async (c) => {
    await requireAdmin(view, c);
    const body = parseWith(PriceScoutQuotaSchema, await readJson(c));
    const p = platform(c);
    const touches =
      body.platform_searches_month !== undefined || body.platform_tokens_month !== undefined;
    if (!p && touches)
      throw new AppError("PACK_FORBIDDEN", 403, "Chỉ quản trị nền tảng được ghi đè trần");
    const q = {
      searches_month: body.searches_month,
      tokens_month: body.tokens_month,
      platform_searches_month: body.platform_searches_month ?? null,
      platform_tokens_month: body.platform_tokens_month ?? null,
    };
    return c.json(await uc.saveQuota(who(c), q, { writePlatform: p && touches, canOverride: p }));
  });
  return r;
}
