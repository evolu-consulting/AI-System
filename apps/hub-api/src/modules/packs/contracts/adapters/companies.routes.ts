// HD8-FR-09: route danh bạ công ty dưới `/pack/contracts/companies` (như mgmt `routes/companies.py`; công ty theo `?party=`). Đọc =
// quyền `read`, ghi = `write` (guard trước thân). Lỗi luật ⇒ đúng câu mgmt; không đầu vào nào ra 500.
import {
  CompanyCreateSchema,
  CompanyPartySchema,
  CompanyPatchSchema,
  CompanyQuerySchema,
} from "@ai/contracts";
import { type Context, Hono } from "hono";
import type { z } from "zod";
import { AppError, appError } from "../../../../lib/errors";
import { parseQuery, parseWith, readJson } from "../../../../lib/http";
import {
  type PackAccessView,
  type PackGuardVars,
  packGuard,
} from "../../kit/adapters/pack-guard.middleware";
import { type CompaniesUsecase, CompanyFail } from "../application/companies.usecase";

const KEY = "contracts";
const CODE = { 409: "COMPANY_EXISTS", 422: "COMPANY_INVALID", 503: "TAX_UNAVAILABLE" } as const;

function fail(e: unknown): never {
  if (!(e instanceof CompanyFail)) throw e;
  if (e.status === 404) throw appError("NOT_FOUND");
  throw new AppError(CODE[e.status], e.status, e.detail);
}
const run = <T>(p: Promise<T>): Promise<T> => p.catch(fail);
const who = (c: Context<PackGuardVars>) => {
  const u = c.get("user");
  return { tenantId: u.tenantId, userId: u.userId };
};
const body = async <S extends z.ZodType>(c: Context, s: S): Promise<z.output<S>> =>
  parseWith(s, await readJson(c));

export function companiesRoutes(view: PackAccessView, uc: CompaniesUsecase): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const read = packGuard(view, KEY, "read");
  const write = packGuard(view, KEY, "write");
  r.get("/companies", read, async (c) =>
    c.json(await run(uc.list(who(c), parseQuery(c, CompanyQuerySchema).q))),
  );
  r.post("/companies", write, async (c) =>
    c.json(await run(uc.create(who(c), await body(c, CompanyCreateSchema))), 201),
  );
  r.put("/companies", write, async (c) => {
    const q = parseQuery(c, CompanyPartySchema);
    return c.json(await run(uc.update(who(c), q.party, await body(c, CompanyPatchSchema))));
  });
  r.post("/companies/refresh", write, async (c) =>
    c.json(await run(uc.refresh(who(c), parseQuery(c, CompanyPartySchema).party))),
  );
  return r;
}
