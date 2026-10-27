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
import type { RepEngine } from "../domain/rep-current.rules";
import type { LinkCheckLimit } from "./link-check-limit.redis";

const KEY = "contracts";
/** CR-097a (BA R41): không có ô chấm sao/chấm tay chủ quan thay cho điểm tính toán — chấm tay HD8 đóng; chỉnh tay ±10 qua sổ (HD7). */
const readOnly = () =>
  new AppError(
    "SCORING_READ_ONLY",
    410,
    "Không chấm tay theo tiêu chí (BA R41) — điểm tính từ sự kiện; chỉnh tay ±10 ghi ở sổ đối tác",
  );

/** REP-v3 · CR-101b: V2-E là engine hiện hành ⇒ cách tính HD8 chỉ đọc (cấu hình mới ở `/reputation/config/**`). */
const hd8ReadOnly = () =>
  new AppError(
    "SCORING_READ_ONLY",
    410,
    "Cách tính điểm cũ chỉ đọc (CR-101b) — cấu hình uy tín ở /reputation/config",
  );

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
  engine: () => RepEngine = () => "hd8",
): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const g: Routes = {
    r,
    uc,
    engine,
    read: packGuard(view, KEY, "read"),
    write: packGuard(view, KEY, "write"),
    isAdmin: async (c) => {
      const i = await packAccessInput(view, KEY, c.get("user"));
      return checkPackAccess({ ...i, grantedGroupIds: i.grantedByAction.admin }) === "ok";
    },
  };
  partnerRoutes(g);
  scoringRoutes(g);
  priceRoutes(g, limit);
  return r;
}

type Guard = ReturnType<typeof packGuard>;
type Routes = {
  r: Hono<PackGuardVars>;
  uc: PartnersUsecase;
  engine: () => RepEngine;
  read: Guard;
  write: Guard;
  isAdmin: (c: Context<PackGuardVars>) => Promise<boolean>;
};

function partnerRoutes({ r, uc, read, write }: Routes): void {
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
  // CR-097a (R41): chấm tay theo tiêu chí đóng (410); thân vẫn kiểm (400) trước.
  r.put("/partners/ratings", write, async (c) => {
    await body(c, RatingRequestSchema);
    throw readOnly();
  });
}

function scoringRoutes({ r, uc, engine, read, write, isAdmin }: Routes): void {
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
    const b = await body(c, ScoringDraftSchema);
    // REP-v3: cờ `v2e` ⇒ HD8 chỉ đọc (410). Cờ tắt (CR-097a R45): HD8 hiện hành — lưu tăng version + lịch sử + ảnh chụp điểm.
    if (engine() === "v2e") throw hd8ReadOnly();
    return c.json(await run(uc.save(who(c), role, b)));
  });
}

function priceRoutes({ r, uc, read, write, isAdmin }: Routes, limit: LinkCheckLimit): void {
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
}
