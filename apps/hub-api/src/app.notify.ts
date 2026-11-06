// N3 thông báo + CR-121 c21b: tách khỏi `app.ts` (giữ ≤ 400 dòng).
import type { Env, Hono } from "hono";
import type { Redis } from "./lib/redis";
import { mailRelayLimit } from "./modules/internal/mail-relay.limit";
import { mountMailRelay } from "./modules/internal/mail-relay.routes";
import { mountNotify } from "./modules/notify/notify.mount";

/** N3 thông báo + CR-121 c21b: `/internal/mail` (admin-api gửi mail nền tảng qua Hub) dùng đúng transport email của thông báo. */
export function mountNotifyAndRelay<E extends Env>(
  app: Hono<E>,
  d: Parameters<typeof mountNotify>[1] & { internalToken?: string; redis?: Redis },
) {
  const email = mountNotify(app, d).email;
  mountMailRelay(app, {
    token: d.internalToken,
    limit: mailRelayLimit({ redis: d.redis }),
    send: email && ((msgs) => email.sendBatch(msgs)),
    log: d.log,
  });
}
