// N3 thông báo + CR-121 c21b: tách khỏi `app.ts` (giữ ≤ 400 dòng).
import type { Env, Hono } from "hono";
import type { Redis } from "./lib/redis";
import { mailRelayLimit } from "./modules/internal/mail-relay.limit";
import { mountMailRelay } from "./modules/internal/mail-relay.routes";
import { mountNotify } from "./modules/notify/notify.mount";
import {
  mountPartnerPublic,
  startPartnerEmailLoop,
} from "./modules/partners/partners.public.mount";

/** N3 thông báo + CR-121 c21b: `/internal/mail` (admin-api gửi mail nền tảng qua Hub) dùng đúng transport email của thông báo. */
export function mountNotifyAndRelay<E extends Env>(
  app: Hono<E>,
  d: Parameters<typeof mountNotify>[1] & {
    internalToken?: string;
    redis?: Redis;
    partnerMailbox?: boolean;
    trustProxyHops?: number;
    processLoops?: boolean;
  },
) {
  const email = mountNotify(app, d).email;
  // CR-124 · q5 · trang công khai trả lời qua link email (không JWT, token riêng; ngoài PROTECTED_PREFIXES). Chỉ khi `partnerMailbox` bật.
  mountPartnerPublic(app, d);
  // CR-124 · q5 · email cho bên nhận chưa dùng nền tảng: cùng cờ + cùng cờ vòng nền với bộ chuyển hộp thư (test gọi `partnerEmailOnce`).
  if (d.partnerMailbox === true && d.processLoops !== false)
    startPartnerEmailLoop({
      db: d.db,
      log: d.log,
      email,
      baseUrl: d.notify?.baseUrl ?? "http://localhost:3300",
      signal: d.signal,
    });
  mountMailRelay(app, {
    token: d.internalToken,
    limit: mailRelayLimit({ redis: d.redis }),
    send: email && ((msgs) => email.sendBatch(msgs)),
    log: d.log,
  });
}
