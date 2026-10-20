// HD8-FR-01…06 · HD8-NFR-02: route đối tác / điểm uy tín / so giá hàng hoá dưới `/pack/contracts` — như mgmt
// `routes/{scoring,prices}.py`. Guard quyền gói TRƯỚC đọc thân (viewer ghi ⇒ 403, 0 SQL); lưu cách tính cần `admin` (mgmt `owner`);
// vai lạ ⇒ 404 như mgmt `_role`; thân/tham số sai ⇒ 400; luật sai ⇒ 422 đúng câu mgmt. Không đầu vào nào ra 500.
import {
  CompareQuerySchema,
  LinkCheckRequestSchema,
  PartnerQuerySchema,
  PartnersQuerySchema,
  QuoteCreateSchema,
  RatingRequestSchema,
  ScoringDraftSchema,
  ScoringRoleSchema,
} from "@ai/contracts";
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
import { PartnersFail, type PartnersUsecase } from "../application/partners.usecase";
import type { LinkCheckLimit } from "./link-check-limit.redis";

const KEY = "contracts";

function fail(e: unknown): never {
  if (!(e instanceof PartnersFail)) throw e;
  if (e.kind === "not_found") throw appError("NOT_FOUND");
  if (e.kind === "forbidden") throw new AppError("PACK_FORBIDDEN", 403, e.detail);
  throw new AppError("SCORING_INVALID", 422, e.detail);
}
const run = <T>(p: Promise<T>): Promise<T> => p.catch(fail);
const who = (c: Context<PackGuardVars>) => {
  const u = c.get("user");
  return { tenantId: u.tenantId, userId: u.userId };
};
/** Vai trên đường dẫn: lạ ⇒ 404 (mgmt `_role`). */
const roleOf = (v: string | undefined) => {
  const r = ScoringRoleSchema.safeParse(v);
  if (!r.success) throw appError("NOT_FOUND");
  return r.data;
};
const body = async <S extends z.ZodType>(c: Context, s: S): Promise<z.output<S>> =>
  parseWith(s, await readJson(c));

export function partnersRoutes(
  view: PackAccessView,
  uc: PartnersUsecase,
  limit: LinkCheckLimit,
): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const read = packGuard(view, KEY, "read");
  const write = packGuard(view, KEY, "write");
  const isAdmin = async (c: Context<PackGuardVars>) => {
    const i = await packAccessInput(view, KEY, c.get("user"));
    return checkPackAccess({ ...i, grantedGroupIds: i.grantedByAction.admin }) === "ok";
  };

  r.get("/partners", read, async (c) =>
    c.json(await run(uc.list(who(c), parseQuery(c, PartnersQuerySchema).role))),
  );
  r.get("/partners/score", read, async (c) => {
    const q = parseQuery(c, PartnerQuerySchema);
    return c.json(await run(uc.one(who(c), q.party, q.role)));
  });
  r.get("/partners/ratings", read, async (c) => {
    const q = parseQuery(c, PartnerQuerySchema);
    return c.json(await run(uc.ratings(who(c), q.party, q.role)));
  });
  r.put("/partners/ratings", write, async (c) =>
    c.json(await run(uc.rate(who(c), await body(c, RatingRequestSchema)))),
  );

  r.get("/scoring/:role", read, async (c) =>
    c.json(await run(uc.getConfig(who(c), roleOf(c.req.param("role"))))),
  );
  r.get("/scoring/:role/history", read, async (c) =>
    c.json(await run(uc.history(who(c), roleOf(c.req.param("role"))))),
  );
  r.post("/scoring/:role/preview", read, async (c) => {
    const role = roleOf(c.req.param("role"));
    return c.json(await run(uc.preview(who(c), role, await body(c, ScoringDraftSchema))));
  });
  r.put("/scoring/:role", write, async (c) => {
    const role = roleOf(c.req.param("role"));
    if (!(await isAdmin(c)))
      throw new AppError("PACK_FORBIDDEN", 403, "Chỉ quản lý được chỉnh cách tính điểm");
    return c.json(await run(uc.save(who(c), role, await body(c, ScoringDraftSchema))));
  });

  r.get("/prices/products", read, async (c) => c.json(await run(uc.products(who(c)))));
  r.get("/prices/compare", read, async (c) =>
    c.json(await run(uc.compare(who(c), parseQuery(c, CompareQuerySchema).product))),
  );
  // Báo giá có link ⇒ máy chủ mở link: tính vào trần kiểm link của người dùng (review HD78 #3).
  r.post("/prices/quotes", write, async (c) => {
    const b = await body(c, QuoteCreateSchema);
    if (b.url) await limit(who(c).tenantId, who(c).userId);
    return c.json(await run(uc.addQuote(who(c), b)), 201);
  });
  r.post("/prices/check-link", write, async (c) => {
    const b = await body(c, LinkCheckRequestSchema);
    await limit(who(c).tenantId, who(c).userId);
    return c.json(await run(uc.checkLink(b.url, b.price)));
  });
  // Xoá báo giá: quản lý (`admin`, mgmt owner) — review HD78 #2; DB còn chặn theo luật thấy M1.
  r.delete("/prices/quotes/:id", write, async (c) => {
    const id = parseWith(z.uuid(), c.req.param("id"));
    if (!(await isAdmin(c)))
      throw new AppError("PACK_FORBIDDEN", 403, "Chỉ quản lý được xoá báo giá");
    return c.json(await run(uc.deleteQuote(who(c), id)));
  });
  return r;
}
