// CR-181 · lát s2 · route HTTP của chữ ký nội bộ (mỏng: zod ở biên → service). JWT gắn ở gốc (`SIGNATURE_PROTECTED_PREFIXES`).
// Tenant/người dùng CHỈ từ token (BR-K2): body/query không có trường user (strict) ngoại trừ `user_id` của «cho phép đổi» (quản trị).
import {
  CreateSignatureBodySchema,
  GrantChangeBodySchema,
  SignatureChangeListQuerySchema,
  SignatureSettingsSchema,
} from "@ai/contracts/signature";
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { parseJson, parseQuery } from "../../../lib/http";
import type { SignatureService } from "../application/signature.service";

export const ME_SIGNATURE_PREFIX = "/me/signature";
export const COMPANY_PREFIX = "/company";
/** Gốc cần JWT (app.ts đưa vào PROTECTED_PREFIXES ⇒ 401 trước 404). */
export const SIGNATURE_PROTECTED_PREFIXES = [ME_SIGNATURE_PREFIX, COMPANY_PREFIX] as const;

/** Mount dưới `/me/signature`. */
export function meSignatureRoutes(svc: SignatureService): Hono<AuthVars> {
  const r = new Hono<AuthVars>();
  r.get("/", async (c) => c.json(await svc.getMine(c.var.user)));
  r.post("/", async (c) => {
    const b = await parseJson(c, CreateSignatureBodySchema);
    return c.json(await svc.create(c.var.user, b), 201);
  });
  r.post("/change-request", async (c) => {
    const out = await svc.requestChange(c.var.user);
    return c.json(out.body, out.created ? 201 : 200);
  });
  return r;
}

/** Mount dưới `/company`. */
export function companySignatureRoutes(svc: SignatureService): Hono<AuthVars> {
  const r = new Hono<AuthVars>();
  r.get("/signature-settings", async (c) => c.json(await svc.getSettings(c.var.user)));
  r.put("/signature-settings", async (c) => {
    const b = await parseJson(c, SignatureSettingsSchema);
    return c.json(await svc.putSettings(c.var.user, b));
  });
  r.get("/signature-change-requests", async (c) => {
    const q = parseQuery(c, SignatureChangeListQuerySchema);
    return c.json(await svc.listRequests(c.var.user, q.limit));
  });
  r.post("/signature-change-grants", async (c) => {
    const b = await parseJson(c, GrantChangeBodySchema);
    const out = await svc.grant(c.var.user, b.user_id);
    return c.json(out.body, out.created ? 201 : 200);
  });
  return r;
}
