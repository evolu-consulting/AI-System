// N3 thông báo + CR-121 c21b: tách khỏi `app.ts` (giữ ≤ 400 dòng).
import type { Env, Hono } from "hono";
import { mountMailRelay } from "./modules/internal/mail-relay.routes";
import { mountNotify } from "./modules/notify/notify.mount";

/** N3 thông báo + CR-121 c21b: `/internal/mail` (admin-api gửi mail nền tảng qua Hub) dùng đúng transport email của thông báo. */
export function mountNotifyAndRelay<E extends Env>(
  app: Hono<E>,
  d: Parameters<typeof mountNotify>[1] & { internalToken?: string },
) {
  const email = mountNotify(app, d).email;
  mountMailRelay(app, {
    token: d.internalToken,
    send: email && ((msgs) => email.sendBatch(msgs)),
    log: d.log,
  });
}
