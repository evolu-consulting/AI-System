// CR-101 DOC-model · R30 API · R42 API: `POST /contracts/:id/attach` (`:id` = HĐ NT, thân `{ids}`) gắn chứng từ có sẵn; `DELETE
// /contracts/:id/frame` (`:id` = con) gỡ liên kết. Quyền `write`; HĐ NT không thấy / tenant khác ⇒ 404; con không thấy / không hợp lệ
// ⇒ 422 FRAME_INVALID; lệch đối tác/hướng ⇒ 422 FRAME_PARTNER_MISMATCH (R43).
import { AttachDocsRequestSchema, DOC_ERRORS } from "@ai/contracts";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { AppError, appError } from "../../../../lib/errors";
import { parseWith, readJson } from "../../../../lib/http";
import {
  type PackAccessView,
  type PackGuardVars,
  packGuard,
} from "../../kit/adapters/pack-guard.middleware";
import { DocFrameFail, type DocFrameUsecases } from "../application/doc-frame.usecase";

const who = (c: Context<PackGuardVars>) => {
  const u = c.get("user");
  return { tenantId: u.tenantId, userId: u.userId };
};
const MSG = {
  FRAME_INVALID: "Document cannot be attached to this framework contract",
  FRAME_PARTNER_MISMATCH: "Document partner or direction differs from the framework contract",
} as const;
const run = <T>(p: Promise<T>): Promise<T> =>
  p.catch((e) => {
    if (!(e instanceof DocFrameFail)) throw e;
    if (e.code === "NOT_FOUND") throw appError("NOT_FOUND");
    throw new AppError(e.code, DOC_ERRORS[e.code], MSG[e.code]);
  });

export function docFrameRoutes(view: PackAccessView, uc: DocFrameUsecases): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const write = packGuard(view, "contracts", "write");
  const id = (c: Context<PackGuardVars>) => parseWith(z.uuid(), c.req.param("id"));
  r.post("/contracts/:id/attach", write, async (c) => {
    const fid = id(c);
    const b = parseWith(AttachDocsRequestSchema, await readJson(c));
    return c.json(await run(uc.attach(who(c), fid, b.ids)));
  });
  r.delete("/contracts/:id/frame", write, async (c) => c.json(await run(uc.detach(who(c), id(c)))));
  return r;
}
