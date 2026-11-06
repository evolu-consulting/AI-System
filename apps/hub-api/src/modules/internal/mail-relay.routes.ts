// CR-121 c21b (D4) · `POST /internal/mail` (token dịch vụ, không JWT/CORS): 200 `MailRelayResponse` · 400 `VALIDATION_ERROR` (gồm thân quá lớn) ·
// 401 `UNAUTHORIZED` (một thân) · 409 `NOT_CONFIGURED` (kho chưa có cấu hình mail / thông báo tắt) · 429 `MAIL_RELAY_LIMIT` (trần mỗi phút) · 502 `MAIL_SEND_FAILED` ·
// 503 `UNAVAILABLE` (Hub chưa có token dịch vụ). Mọi phản hồi `no-store`; không log thân/header.
import { HUB_INTERNAL_ERRORS, MAIL_RELAY_TEXT_MAX_BYTES } from "@ai/contracts/hub-internal";
import { type Env, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { toErrorBody } from "../../lib/errors";
import { type MailRelayDeps, type MailRelayOutcome, MailRelayService } from "./mail-relay.service";

const NO_STORE = { "Cache-Control": "no-store" };
const BODY_MAX = MAIL_RELAY_TEXT_MAX_BYTES + 16 * 1024;
const E = HUB_INTERNAL_ERRORS;

function respond(c: import("hono").Context, o: MailRelayOutcome): Response {
  switch (o.kind) {
    case "ok":
      return c.json(o.body, 200, NO_STORE);
    case "unavailable":
      return c.json(toErrorBody("UNAVAILABLE", "Service unavailable"), E.UNAVAILABLE, NO_STORE);
    case "unauthorized":
      return c.json(toErrorBody("UNAUTHORIZED", "Unauthorized"), E.UNAUTHORIZED, {
        ...NO_STORE,
        "WWW-Authenticate": "Bearer",
      });
    case "limited":
      return c.json(toErrorBody("MAIL_RELAY_LIMIT", "Too many requests"), E.MAIL_RELAY_LIMIT, {
        ...NO_STORE,
        "Retry-After": "60",
      });
    case "invalid":
      return c.json(
        toErrorBody("VALIDATION_ERROR", "Invalid request"),
        E.VALIDATION_ERROR,
        NO_STORE,
      );
    case "not_configured":
      return c.json(
        toErrorBody("NOT_CONFIGURED", "Mail not configured"),
        E.NOT_CONFIGURED,
        NO_STORE,
      );
    case "failed":
      return c.json(
        toErrorBody("MAIL_SEND_FAILED", "Mail send failed"),
        E.MAIL_SEND_FAILED,
        NO_STORE,
      );
  }
}

export function mailRelayRoutes(svc: MailRelayService): Hono {
  const r = new Hono();
  r.post(
    "/mail",
    bodyLimit({
      maxSize: BODY_MAX,
      onError: (c) =>
        c.json(toErrorBody("VALIDATION_ERROR", "Invalid request"), E.VALIDATION_ERROR, NO_STORE),
    }),
    async (c) => respond(c, await svc.relay(c.req.header("authorization"), await c.req.text())),
  );
  return r;
}

/** Mount `/internal/mail` (gọi trước `notFound`). */
export function mountMailRelay<V extends Env>(app: Hono<V>, d: MailRelayDeps): void {
  app.route("/internal", mailRelayRoutes(new MailRelayService(d)));
}
