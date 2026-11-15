// CR-152 · `GET|PUT /contracts/:id/kind-terms` (trường riêng Nhượng quyền / Hợp tác) và `PUT /contracts/:id/periods/:key` (ghi doanh thu kỳ /
// đối soát). Đọc: quyền `read`; ghi: quyền `write` như sửa mốc HĐ. HĐ không thấy / tenant khác ⇒ 404; HĐ không phải hai loại ⇒ 422.
import {
  KIND_ERRORS,
  KIND_TERMS_BY_DEAL,
  KindTermsPutSchema,
  PeriodKeySchema,
  PeriodRecordSchema,
} from "@ai/contracts/pack-contracts";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { AppError, appError } from "../../../../lib/errors";
import { parseWith, readJson } from "../../../../lib/http";
import { type PackAccessView, type PackGuardVars, packGuard } from "../../kit/public";
import { KindFail, type KindTermsUsecases } from "../application/kind-terms.usecase";
import { isKindDeal } from "../domain/kind-terms.rules";

const who = (c: Context<PackGuardVars>) => {
  const u = c.get("user");
  return { tenantId: u.tenantId, userId: u.userId };
};
const MSG = {
  KIND_TERMS_NOT_APPLICABLE:
    "Contract is not a franchise or cooperation agreement (or has no revenue reporting)",
  KIND_TERMS_LOCKED: "Terms can only be edited while the contract is a draft",
  PERIOD_LOCKED: "The fee milestone of this period is already confirmed",
} as const;
const run = <T>(p: Promise<T>): Promise<T> =>
  p.catch((e) => {
    if (!(e instanceof KindFail)) throw e;
    if (e.code === "NOT_FOUND") throw appError("NOT_FOUND");
    throw new AppError(e.code, KIND_ERRORS[e.code], MSG[e.code]);
  });

export function kindTermsRoutes(view: PackAccessView, uc: KindTermsUsecases): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const read = packGuard(view, "contracts", "read");
  const write = packGuard(view, "contracts", "write");
  const id = (c: Context<PackGuardVars>) => parseWith(z.uuid(), c.req.param("id"));
  r.get("/contracts/:id/kind-terms", read, async (c) => c.json(await run(uc.get(who(c), id(c)))));
  r.put("/contracts/:id/kind-terms", write, async (c) => {
    const cid = id(c);
    const b = parseWith(KindTermsPutSchema, await readJson(c));
    // Biết loại HĐ mới chọn được schema chặt của loại đó: đọc loại qua `get` (cùng quyền, 404/422 đúng mã), rồi kiểm khoá/kiểu.
    const cur = await run(uc.get(who(c), cid));
    if (!isKindDeal(cur.deal)) throw appError("NOT_FOUND");
    const patch = parseWith(KIND_TERMS_BY_DEAL[cur.deal], b.terms);
    return c.json(await run(uc.put(who(c), cid, patch as Record<string, unknown>)));
  });
  r.put("/contracts/:id/periods/:key", write, async (c) => {
    const key = parseWith(PeriodKeySchema, c.req.param("key"));
    const b = parseWith(PeriodRecordSchema, await readJson(c));
    return c.json(await run(uc.record(who(c), id(c), key, b.figure)));
  });
  return r;
}
