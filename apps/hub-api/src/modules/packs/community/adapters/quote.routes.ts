// CR-102b · C7b · `/pack/community/posts/:id/quote*` + `/quote/match`. Chỉ thành viên chủ quản có quyền ghi; đối tác 403 (HT-64/65).
import { QuoteInputSchema } from "@ai/contracts/community";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { appError } from "../../../../lib/errors";
import { parseIdParam, parseWith, readJson } from "../../../../lib/http";
import type { PackGuardVars } from "../../kit/adapters/pack-guard.middleware";
import { accessOf } from "./community-access";
import type { CommunityDeps } from "./community-deps";
import * as quote from "./quote.service";

export const quoteDeps = (d: CommunityDeps): quote.QuoteDeps => ({
  uow: d.uow,
  quotes: d.quotes,
  hostBook: d.hostBook,
  webUrl: d.webUrl,
});

export function quoteRoutes(d: CommunityDeps): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const qd = quoteDeps(d);
  const host = async (c: Context<PackGuardVars>) => {
    const a = await accessOf(d.view, d.resolver, c, "write");
    quote.requireHost(a);
    return a;
  };

  r.post("/posts/:id/quote/preview", async (c) => {
    const a = await host(c);
    const q = parseWith(QuoteInputSchema, await readJson(c));
    return c.json(await quote.preview(qd, a, parseIdParam(c), q));
  });

  r.post("/posts/:id/quote", async (c) => {
    const a = await host(c);
    const q = parseWith(QuoteInputSchema, await readJson(c));
    return c.json(await quote.save(qd, a, parseIdParam(c), q), 201);
  });

  r.get("/quote/match", async (c) => {
    const a = await host(c);
    const text = z.string().trim().min(1).max(200).safeParse(c.req.query("q"));
    if (!text.success) throw appError("VALIDATION_ERROR");
    return c.json({ hint: await quote.matchHint(qd, a, text.data) });
  });

  return r;
}
