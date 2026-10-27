// cf-esign-docusign · route ký số dưới `/pack/contracts` (trung lập nhà cung cấp). Quyền: xem trạng thái/làm mới/tải bản đã ký = `read`
// (ai đọc được HĐ — RLS M1); gửi ký/"Ký ngay"/huỷ = `write` (owner/editor); bật/tắt ở Cài đặt = `admin` (owner).
//   GET  /esign/settings                     {configured, enabled, provider, demo}
//   PUT  /esign/settings                     {enabled}
//   GET  /contracts/:id/esign                trạng thái + người ký gợi ý
//   POST /contracts/:id/esign                gửi ký {signers[]} (tuần tự)
//   POST /contracts/:id/esign/refresh        làm mới trạng thái (một lần)
//   POST /contracts/:id/esign/sign-url       "Ký ngay" {return_url} ⇒ {url}
//   POST /contracts/:id/esign/void           huỷ {reason}
//   GET  /contracts/:id/esign/signed-link    {url} của "Bản đã ký"
// Webhook (KHÔNG JWT, gắn trước auth ở `app.ts`): POST /pack/contracts/esign/webhook/:provider.
import {
  ESIGN_ERRORS,
  ESignSendSchema,
  ESignSettingsSchema,
  ESignSignUrlSchema,
  ESignVoidSchema,
} from "@ai/contracts";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { AppError, appError } from "../../../../lib/errors";
import { parseWith, readJson } from "../../../../lib/http";
import { logger } from "../../../../lib/logger";
import {
  type PackAccessView,
  type PackGuardVars,
  packGuard,
} from "../../kit/adapters/pack-guard.middleware";
import { ESignProviderError } from "../application/esign.ports";
import { ESignFail, type ESignUsecase } from "../application/esign.usecase";

const KEY = "contracts";
export const ESIGN_WEBHOOK_PATH = "/pack/contracts/esign/webhook";
const MAX_WEBHOOK_BYTES = 256 * 1024;

const who = (c: Context<PackGuardVars>) => {
  const u = c.get("user");
  return { tenantId: u.tenantId, userId: u.userId };
};
const idOf = (c: Context<PackGuardVars>) => parseWith(z.uuid(), c.req.param("id"));

const run = <T>(p: Promise<T>): Promise<T> =>
  p.catch((e) => {
    if (e instanceof ESignFail) {
      if (e.code === "NOT_FOUND") throw appError("NOT_FOUND");
      if (e.code === "VALIDATION") throw new AppError("VALIDATION_ERROR", 400, e.detail);
      throw new AppError(e.code, ESIGN_ERRORS[e.code], e.detail);
    }
    if (e instanceof ESignProviderError) {
      logger.warn("esign-provider-error", { detail: e.detail });
      throw new AppError("ESIGN_PROVIDER", ESIGN_ERRORS.ESIGN_PROVIDER, "provider");
    }
    throw e;
  });

export function esignRoutes(view: PackAccessView, u: ESignUsecase): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const read = packGuard(view, KEY, "read");
  const write = packGuard(view, KEY, "write");
  const admin = packGuard(view, KEY, "admin");
  r.get("/esign/settings", read, async (c) => c.json(await run(u.settings(who(c)))));
  r.put("/esign/settings", admin, async (c) => {
    const b = parseWith(ESignSettingsSchema, await readJson(c));
    return c.json(await run(u.saveSettings(who(c), b.enabled)));
  });
  r.get("/contracts/:id/esign", read, async (c) => c.json(await run(u.state(who(c), idOf(c)))));
  r.post("/contracts/:id/esign", write, async (c) => {
    const id = idOf(c);
    const b = parseWith(ESignSendSchema, await readJson(c));
    return c.json(await run(u.send(who(c), id, b.signers)), 201);
  });
  r.post("/contracts/:id/esign/refresh", read, async (c) =>
    c.json(await run(u.refresh(who(c), idOf(c)))),
  );
  r.post("/contracts/:id/esign/sign-url", write, async (c) => {
    const id = idOf(c);
    const b = parseWith(ESignSignUrlSchema, await readJson(c));
    c.header("cache-control", "no-store");
    return c.json(await run(u.signUrl(who(c), id, b.return_url)));
  });
  r.post("/contracts/:id/esign/void", write, async (c) => {
    const id = idOf(c);
    const b = parseWith(ESignVoidSchema, await readJson(c));
    return c.json(await run(u.voidIt(who(c), id, b.reason)));
  });
  r.get("/contracts/:id/esign/signed-link", read, async (c) => {
    const url = await run(u.signedLink(who(c), idOf(c)));
    if (!url) throw appError("NOT_FOUND");
    c.header("cache-control", "no-store");
    return c.json({ url });
  });
  return r;
}

/** Webhook nhà cung cấp — không JWT; xác thực do adapter (DocuSign: HMAC). Thân thô ≤ 256 KiB. Không log thân. */
export function esignWebhookRoutes(u: ESignUsecase): Hono {
  const r = new Hono();
  r.post("/:provider", async (c) => {
    const raw = new Uint8Array(await c.req.arrayBuffer());
    if (raw.byteLength > MAX_WEBHOOK_BYTES)
      throw new AppError("PAYLOAD_TOO_LARGE", 413, "too large");
    const key = c.req.param("provider");
    const res = await run(u.webhook(key, raw, (n) => c.req.header(n)));
    return c.json({ ok: true, result: res });
  });
  return r;
}
