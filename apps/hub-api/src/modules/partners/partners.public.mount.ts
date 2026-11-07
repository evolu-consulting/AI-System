// CR-124 · q5 · nối đường email của hộp thư liên công ty: (1) trang công khai `/partner-reply/:token` (gắn TRƯỚC JWT ở `app.ts`, như webhook ký số);
// (2) bộ gửi email (vòng nền, dùng transport email chung của thông báo — gắn ở `app.notify.ts`). Cả hai chỉ khi `HUB_PARTNER_MAILBOX=on` (mặc định TẮT).
import type { Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { Env, Hono } from "hono";
import type { Logger } from "../../lib/logger";
import type { Redis } from "../../lib/redis";
import { partnerMailboxPort } from "../packs/kit/public";
import { replyByToken, viewByToken } from "./adapters/email.repo";
import { partnerPublicRoutes } from "./adapters/partner-public.routes";
import { windowLimit } from "./adapters/window-limit";
import { PARTNER_PUBLIC_PATH } from "./domain/email-link.rules";
import type { PublicStore } from "./domain/email-view.types";
import { type PartnerMailer, startPartnerEmail } from "./email-dispatch";

const SYS = { kind: "system" as const };

/** Cổng dữ liệu trang công khai: mỗi lời gọi một tx scope system, MỘT hàm DEFINER (số câu cố định). */
export const publicStore = (db: Db): PublicStore => ({
  view: (h, o) => withHubScope(db, SYS, (tx) => viewByToken(tx, h, o)),
  reply: (h, f, o) => withHubScope(db, SYS, (tx) => replyByToken(tx, h, f, o)),
});

export function mountPartnerPublic<E extends Env>(
  app: Hono<E>,
  d: {
    db?: Db | undefined;
    partnerMailbox?: boolean | undefined;
    redis?: Redis | undefined;
    log: Logger;
    now?: () => Date;
  },
): void {
  if (!d.db || d.partnerMailbox !== true) return;
  app.route(
    PARTNER_PUBLIC_PATH,
    partnerPublicRoutes({
      store: publicStore(d.db),
      limit: windowLimit({ redis: d.redis, ...(d.now ? { now: d.now } : {}) }),
      port: () => partnerMailboxPort.get(),
      log: d.log,
    }) as never,
  );
}

/** Vòng gửi email nền; `email` null (thông báo tắt) ⇒ cảnh báo một lần, không gửi. */
export function startPartnerEmailLoop(d: {
  db: Db;
  log: Logger;
  email: PartnerMailer | null;
  baseUrl: string;
  signal?: AbortSignal | undefined;
}): void {
  if (!d.email) {
    d.log.warn("partner-email-disabled", { reason: "notify_transport_off" });
    return;
  }
  const email = d.email;
  startPartnerEmail(
    {
      db: d.db,
      log: d.log,
      email: () => email,
      baseUrl: d.baseUrl,
      port: () => partnerMailboxPort.get(),
    },
    d.signal ? { signal: d.signal } : {},
  );
}
