// N3-FR-07 · D-03 · chọn transport theo `HUB_NOTIFY_MODE`: `off` (mặc định, không worker) · `fake` (dev/e2e, ghi trong RAM) ·
// `live` (SMTP/Web Push thật — CHƯA có adapter: cần thư viện ngoài ADR-0001 ⇒ ADR-0027 Proposed ⇒ fail-closed, Hub không lên).
import type { EmailTransport, PushTransport } from "../application/ports";
import { FakeEmailTransport, FakePushTransport } from "./transport.fake";

export const NOTIFY_MODES = ["off", "fake", "live"] as const;
export type NotifyMode = (typeof NOTIFY_MODES)[number];

export type Transports = { email: EmailTransport; push: PushTransport };

export class NotifyNotConfigured extends Error {
  readonly code = "NOT_CONFIGURED";
  constructor(readonly reason: "adapter_missing") {
    super(`notify: ${reason}`);
    this.name = "NotifyNotConfigured";
  }
}

/** `off` ⇒ null (không dựng worker). `live` ⇒ ném `NotifyNotConfigured` tới khi ADR-0027 được duyệt và có adapter. */
export function transportsFor(mode: NotifyMode): Transports | null {
  if (mode === "off") return null;
  if (mode === "fake") return { email: new FakeEmailTransport(), push: new FakePushTransport() };
  throw new NotifyNotConfigured("adapter_missing");
}
