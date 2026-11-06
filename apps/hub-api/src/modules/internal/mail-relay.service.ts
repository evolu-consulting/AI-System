// CR-121 c21b (D4) · `POST /internal/mail`: admin-api (dịch vụ) nhờ Hub gửi mail nền tảng bằng cấu hình trong kho secret Hub.
// Quyền kiểm Ở ĐÂY (service): chỉ người mang token dịch vụ `HUB_INTERNAL_TOKEN` (so hằng thời gian); vắng token cấu hình ⇒ không ai
// gọi được (503). Không log token/thân/địa chỉ/chủ đề: chỉ mã lỗi cố định. Thông báo chuông/email của người dùng KHÔNG đi đường này.
import { MailRelayRequestSchema, type MailRelayResponse } from "@ai/contracts/hub-internal";
import type { Logger } from "../../lib/logger";
import { serviceTokenMatches } from "./test-run.auth";

/** Một thư gửi tới một người nhận (khớp cổng email của module thông báo, định nghĩa cục bộ để không import chéo module). */
export type RelayMail = {
  idempotencyKey: string;
  tenantId: string;
  to: string;
  toName: string;
  subject: string;
  text: string;
};
export type RelayResult = { ok: boolean; skip?: boolean };
export type MailRelaySend = (msgs: readonly RelayMail[]) => Promise<RelayResult[]>;

export type MailRelayOutcome =
  | { kind: "ok"; body: MailRelayResponse }
  | { kind: "unavailable" }
  | { kind: "unauthorized" }
  | { kind: "limited" }
  | { kind: "invalid" }
  | { kind: "not_configured" }
  | { kind: "failed" };

export type MailRelayDeps = {
  /** `HUB_INTERNAL_TOKEN`; vắng ⇒ `unavailable`. */
  token: string | undefined;
  /** Trần mỗi phút (xét SAU khi xác thực: người lạ không tiêu hao ngân sách của dịch vụ); vắng ⇒ không giới hạn. */
  limit?: () => Promise<boolean>;
  /** Vắng (notify tắt) ⇒ `not_configured`. */
  send: MailRelaySend | null;
  log: Pick<Logger, "warn">;
};

const PLATFORM = "platform";

/** Lỗi do cấu hình/secret chưa sẵn (SecretUseError, MailConfigInvalid, NotifyNotConfigured đều mang `code = NOT_CONFIGURED`). */
const isNotConfigured = (e: unknown): boolean =>
  (e as { code?: unknown } | null)?.code === "NOT_CONFIGURED";

export class MailRelayService {
  constructor(private readonly d: MailRelayDeps) {}

  async relay(authorization: string | undefined, raw: string): Promise<MailRelayOutcome> {
    if (!this.d.token) return { kind: "unavailable" };
    if (!serviceTokenMatches(this.d.token, authorization)) return { kind: "unauthorized" };
    if (this.d.limit && !(await this.d.limit())) return { kind: "limited" };
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return { kind: "invalid" };
    }
    const req = MailRelayRequestSchema.safeParse(json);
    if (!req.success) return { kind: "invalid" };
    if (!this.d.send) return { kind: "not_configured" };
    const batch = crypto.randomUUID();
    const msgs = req.data.to.map<RelayMail>((to, i) => ({
      idempotencyKey: `relay-${batch}-${i}`,
      tenantId: PLATFORM,
      to,
      toName: to,
      subject: req.data.subject,
      text: req.data.text,
    }));
    let results: RelayResult[];
    try {
      results = await this.d.send(msgs);
    } catch (err) {
      if (isNotConfigured(err)) return { kind: "not_configured" };
      this.d.log.warn("mail_relay_failed", { code: "MAIL_SEND_FAILED" });
      return { kind: "failed" };
    }
    const skipped = results.filter((r) => !r.ok && r.skip).length;
    const sent = results.filter((r) => r.ok).length;
    if (sent + skipped < msgs.length) {
      this.d.log.warn("mail_relay_failed", {
        code: "MAIL_SEND_FAILED",
        failed: msgs.length - sent - skipped,
      });
      return { kind: "failed" };
    }
    return { kind: "ok", body: { sent, skipped } };
  }
}
