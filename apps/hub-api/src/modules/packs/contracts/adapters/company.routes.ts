// V2-L · CD-01: `GET|PUT /pack/contracts/company`. Đọc: quyền đọc gói (sidebar/menu của mọi người dùng); ghi: chỉ quản lý (Q3,
// `contracts-owner`). Guard gói TRƯỚC đọc thân (viewer ghi ⇒ 403, 0 SQL); thân sai ⇒ 400; luật sai (trùng MST…) ⇒ 422.
import { COMPANY_ERRORS, CompanySchema } from "@ai/contracts";
import { type Context, Hono } from "hono";
import { AppError } from "../../../../lib/errors";
import { parseWith, readJson } from "../../../../lib/http";
import {
  type PackAccessView,
  type PackGuardVars,
  packAccessInput,
  packGuard,
} from "../../kit/adapters/pack-guard.middleware";
import { checkPackAccess } from "../../kit/domain/pack-access.rules";
import { CompanyFail, type CompanyUsecase } from "../application/company.usecase";

const KEY = "contracts";

export function companyRoutes(view: PackAccessView, uc: CompanyUsecase): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const read = packGuard(view, KEY, "read");
  const write = packGuard(view, KEY, "write");
  const who = (c: Context<PackGuardVars>) => {
    const u = c.get("user");
    return { tenantId: u.tenantId, userId: u.userId };
  };
  r.get("/company", read, async (c) => c.json(await uc.get(who(c))));
  r.put("/company", write, async (c) => {
    const i = await packAccessInput(view, KEY, c.get("user"));
    if (checkPackAccess({ ...i, grantedGroupIds: i.grantedByAction.admin }) !== "ok")
      throw new AppError("PACK_FORBIDDEN", 403, "Chỉ quản lý được đổi cài đặt công ty");
    const body = parseWith(CompanySchema, await readJson(c));
    try {
      return c.json(await uc.save(who(c), body));
    } catch (e) {
      if (e instanceof CompanyFail)
        throw new AppError("COMPANY_INVALID", COMPANY_ERRORS.COMPANY_INVALID, e.detail);
      throw e;
    }
  });
  return r;
}
