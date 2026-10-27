// esign-anchor · route vị trí ô ký dưới `/pack/contracts`. Quyền: xem cụm / xem trước vị trí = `read`; sửa cụm = `admin` (owner).
//   GET /esign/anchors                    {a[], b[], is_default}
//   PUT /esign/anchors                    {a[], b[]} (mỗi bên 1–8 cụm, 2–60 ký tự)
//   GET /contracts/:id/esign/placement    {placement: "text" | "page"} (người ký mặc định công ty + đối tác)
import { ESignAnchorsSchema } from "@ai/contracts";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { AppError, appError } from "../../../../lib/errors";
import { parseWith, readJson } from "../../../../lib/http";
import {
  type PackAccessView,
  type PackGuardVars,
  packGuard,
} from "../../kit/adapters/pack-guard.middleware";
import { ESignFail } from "../application/esign.helpers";
import type { ESignAnchors } from "../application/esign-anchor.usecase";

const KEY = "contracts";
const who = (c: Context<PackGuardVars>) => {
  const u = c.get("user");
  return { tenantId: u.tenantId, userId: u.userId };
};

const run = <T>(p: Promise<T>): Promise<T> =>
  p.catch((e) => {
    if (e instanceof ESignFail && e.code === "NOT_FOUND") throw appError("NOT_FOUND");
    if (e instanceof ESignFail && e.code === "VALIDATION")
      throw new AppError("VALIDATION_ERROR", 400, e.detail);
    throw e;
  });

export function esignAnchorRoutes(view: PackAccessView, u: ESignAnchors): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const read = packGuard(view, KEY, "read");
  const admin = packGuard(view, KEY, "admin");
  r.get("/esign/anchors", read, async (c) => c.json(await run(u.lists(who(c)))));
  r.put("/esign/anchors", admin, async (c) => {
    const b = parseWith(ESignAnchorsSchema, await readJson(c));
    return c.json(await run(u.saveLists(who(c), b)));
  });
  r.get("/contracts/:id/esign/placement", read, async (c) => {
    const id = parseWith(z.uuid(), c.req.param("id"));
    return c.json(await run(u.preview(who(c), id)));
  });
  return r;
}
