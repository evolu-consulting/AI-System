// N3-FR-07 · D-03 · ADR-0027 · chọn transport theo `HUB_NOTIFY_MODE`: `off` (mặc định, không worker) · `fake` (dev/e2e, ghi trong RAM) ·
// `live` (SMTP `nodemailer` + Web Push `web-push`; cấu hình nền tảng một bộ, bí mật lấy từ env hoặc `hub.secrets`).
import type { EmailTransport, PushTransport } from "../application/ports";
import { createSmtpTransport, type SmtpConfig } from "./smtp.transport";
import { FakeEmailTransport, FakePushTransport } from "./transport.fake";
import { createWebPushTransport, type VapidConfig } from "./webpush.transport";

export const NOTIFY_MODES = ["off", "fake", "live"] as const;
export type NotifyMode = (typeof NOTIFY_MODES)[number];

export type Transports = { email: EmailTransport; push: PushTransport };

/** Cấu hình `live`: phần không bí mật + cách lấy bí mật (env trước, kho secret Hub sau). Không bao giờ log. */
export type LiveNotifyConfig = {
  smtp: SmtpConfig;
  vapid: VapidConfig | null;
  smtpPassword: () => Promise<string | undefined>;
  vapidPrivateKey: () => Promise<string | undefined>;
};

export class NotifyNotConfigured extends Error {
  readonly code = "NOT_CONFIGURED";
  constructor(readonly reason: "live_config_missing") {
    super(`notify: ${reason}`);
    this.name = "NotifyNotConfigured";
  }
}

/** `off` ⇒ null (không dựng worker). `live` thiếu cấu hình ⇒ ném `NotifyNotConfigured`. */
export function transportsFor(mode: NotifyMode, live?: LiveNotifyConfig): Transports | null {
  if (mode === "off") return null;
  if (mode === "fake") return { email: new FakeEmailTransport(), push: new FakePushTransport() };
  if (!live) throw new NotifyNotConfigured("live_config_missing");
  return {
    email: createSmtpTransport(live.smtp, live.smtpPassword),
    push: createWebPushTransport(live.vapid, live.vapidPrivateKey),
  };
}
