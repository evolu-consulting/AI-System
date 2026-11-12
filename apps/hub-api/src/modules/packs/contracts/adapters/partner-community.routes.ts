// CR-130 pha 2 · L3: route hồ sơ Bảng tin của đối tác dưới `/pack/contracts/partners/community*`. Đọc = `read`; ghi + danh sách tài
// khoản chọn được = quản trị gói (`admin`, khớp RLS 0103). Đối tác ngoài phạm vi ⇒ 404; tài khoản lạ ⇒ 422; đã gắn đối tác khác ⇒ 409.
import {
  PartnerCommunityAccountPutSchema,
  PartnerCommunityProfilePutSchema,
  PartnerCommunityQuerySchema,
} from "@ai/contracts/pack-contracts";
import { type Context, Hono } from "hono";
import { AppError, appError } from "../../../../lib/errors";
import { parseQuery, parseWith, readJson } from "../../../../lib/http";
import { type PackAccessView, type PackGuardVars, packGuard } from "../../kit/public";
import {
  PartnerCommunityFail,
  type PartnerCommunityUsecase,
} from "../application/partner-community.usecase";

const KEY = "contracts";

function fail(e: unknown): never {
  if (!(e instanceof PartnerCommunityFail)) throw e;
  if (e.kind === "not_found") throw appError("NOT_FOUND");
  if (e.kind === "invalid_account")
    throw new AppError("INVALID_REFERENCE", 422, "Tài khoản công ty không tồn tại hoặc đã ngừng");
  throw new AppError("PARTNER_ACCOUNT_TAKEN", 409, "Tài khoản này đã gắn với một đối tác khác");
}
const run = <T>(p: Promise<T>): Promise<T> => p.catch(fail);
const who = (c: Context<PackGuardVars>) => {
  const u = c.get("user");
  return { tenantId: u.tenantId, userId: u.userId };
};

export function partnerCommunityRoutes(
  view: PackAccessView,
  uc: PartnerCommunityUsecase,
): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const read = packGuard(view, KEY, "read");
  const admin = packGuard(view, KEY, "admin");

  r.get("/partners/community", read, async (c) =>
    c.json(await run(uc.get(who(c), parseQuery(c, PartnerCommunityQuerySchema).party))),
  );
  r.get("/partners/community/candidates", admin, async (c) =>
    c.json(await run(uc.candidates(who(c)))),
  );
  r.put("/partners/community/profile", admin, async (c) => {
    const b = parseWith(PartnerCommunityProfilePutSchema, await readJson(c));
    return c.json(await run(uc.saveProfile(who(c), b.party, b.cats, b.area ?? "")));
  });
  r.put("/partners/community/account", admin, async (c) => {
    const b = parseWith(PartnerCommunityAccountPutSchema, await readJson(c));
    return c.json(await run(uc.setAccount(who(c), b.party, b.ext_org_id)));
  });
  return r;
}
