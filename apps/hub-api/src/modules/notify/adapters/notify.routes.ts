// N3-FR-04 · N3-FR-09 · route người dùng cuối của chuông thông báo, mount dưới `/notifications` (JWT ở gốc qua PROTECTED_PREFIXES).
// Tenant/user LUÔN lấy từ token; body/query không có trường tenant/user. Validate zod ở biên (strict). Không logic.
import {
  MarkReadBodySchema,
  NotificationListQuerySchema,
  NotifyPrefsSchema,
  PushSubscriptionBodySchema,
  PushUnsubscribeBodySchema,
} from "@ai/contracts";
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { parseJson, parseQuery } from "../../../lib/http";
import type { InboxService } from "../application/inbox.service";

export const NOTIFICATIONS_PREFIX = "/notifications";

export type PushKeyView = { publicKey: string | null };

export function notifyRoutes(svc: InboxService, push: PushKeyView): Hono<AuthVars> {
  const r = new Hono<AuthVars>();
  const who = (c: { var: { user: { tenantId: string; userId: string } } }) => ({
    tenantId: c.var.user.tenantId,
    userId: c.var.user.userId,
  });

  r.get("/", async (c) => {
    const q = parseQuery(c, NotificationListQuerySchema);
    return c.json(await svc.list(who(c), q.limit, q.before ?? null));
  });

  r.post("/read", async (c) => {
    const b = await parseJson(c, MarkReadBodySchema);
    const updated = await svc.markRead(who(c), b.all ? "all" : (b.ids ?? []));
    return c.json({ updated });
  });

  r.get("/prefs", async (c) => c.json(await svc.prefs(who(c))));
  r.put("/prefs", async (c) => {
    const b = await parseJson(c, NotifyPrefsSchema);
    return c.json(await svc.setPrefs(who(c), b));
  });

  r.post("/push/test", async (c) => c.json({ created: await svc.sendTest(who(c)) }));
  r.get("/push/key", (c) => c.json({ public_key: push.publicKey }));
  r.post("/push/subscriptions", async (c) => {
    const b = await parseJson(c, PushSubscriptionBodySchema);
    await svc.subscribe(who(c), { endpoint: b.endpoint, p256dh: b.keys.p256dh, auth: b.keys.auth });
    return c.body(null, 204);
  });
  r.delete("/push/subscriptions", async (c) => {
    const b = await parseJson(c, PushUnsubscribeBodySchema);
    await svc.unsubscribe(who(c), b.endpoint);
    return c.body(null, 204);
  });
  return r;
}
