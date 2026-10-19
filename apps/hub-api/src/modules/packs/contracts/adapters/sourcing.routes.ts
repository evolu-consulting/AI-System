// W1 · "Mua hàng": `GET /pack/contracts/sourcing` (quyền `read`) và `PUT /pack/contracts/sourcing/:contractId/:line` (quyền `write`; người xem
// ⇒ 403 trước khi đọc thân, 0 SQL). `:contractId` sai dạng ⇒ 400; `:line` ngoài 0…9999 ⇒ 400; thân/query strict; HĐ/dòng không có hoặc không
// thấy ⇒ 404 như nhau; nguồn không phải ứng viên cùng sản phẩm ⇒ 422 `SOURCING_INVALID`.
import {
  SOURCING_ERRORS,
  SOURCING_LINE_MAX,
  SourceChoiceSchema,
  SourcingQuerySchema,
} from "@ai/contracts";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { AppError, appError } from "../../../../lib/errors";
import { parseQuery, parseWith, readJson } from "../../../../lib/http";
import {
  type PackAccessView,
  type PackGuardVars,
  packGuard,
} from "../../kit/adapters/pack-guard.middleware";
import { SourcingFail, type SourcingUsecases } from "../application/sourcing.usecase";

const KEY = "contracts";
const who = (c: Context<PackGuardVars>) => {
  const u = c.get("user");
  return { tenantId: u.tenantId, userId: u.userId };
};
const line = (v: string | undefined) =>
  parseWith(
    z
      .string()
      .regex(/^\d{1,4}$/)
      .transform(Number)
      .pipe(z.number().int().max(SOURCING_LINE_MAX)),
    v,
  );

const run = <T>(p: Promise<T>): Promise<T> =>
  p.catch((e) => {
    if (!(e instanceof SourcingFail)) throw e;
    if (e.kind === "not_found") throw appError("NOT_FOUND");
    throw new AppError(
      "SOURCING_INVALID",
      SOURCING_ERRORS.SOURCING_INVALID,
      "Nguồn phải là một dòng giá mua của cùng sản phẩm",
    );
  });

export function sourcingRoutes(
  view: PackAccessView,
  d: { sourcing: SourcingUsecases },
): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  r.get("/sourcing", packGuard(view, KEY, "read"), async (c) => {
    const q = parseQuery(c, SourcingQuerySchema);
    return c.json(await d.sourcing.read(who(c), q));
  });
  r.put("/sourcing/:contractId/:line", packGuard(view, KEY, "write"), async (c) => {
    const id = parseWith(z.uuid(), c.req.param("contractId"));
    const ln = line(c.req.param("line"));
    const body = parseWith(SourceChoiceSchema, await readJson(c));
    return c.json(await run(d.sourcing.choose(who(c), id, ln, body)));
  });
  return r;
}
