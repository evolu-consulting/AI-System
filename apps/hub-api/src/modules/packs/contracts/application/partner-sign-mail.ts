// CR-182 · gửi thư cho đối tác qua transport email chung của thông báo (hoặc ghi link ra log khi `HUB_NOTIFY_MODE=off`).

import type { ContactRow } from "../adapters/partner-sign.repo";
import type { PartnerSignDeps } from "./partner-sign.deps";

/** Thư (hoặc log khi tắt thông báo). Không ném: lỗi gửi ⇒ link vẫn có (người tải lên bấm «Gửi lại»). */
export async function sendMail(
  d: Pick<PartnerSignDeps, "mailer" | "log">,
  tenantId: string,
  to: ContactRow,
  key: string,
  m: { subject: string; text: string; html?: string },
  linkForLog: string | null,
): Promise<boolean> {
  const t = d.mailer();
  if (!to.email) {
    d.log.warn("partner-sign-mail-no-email", {});
    return false;
  }
  if (!t) {
    // HUB_NOTIFY_MODE=off (bản test/dev) ⇒ ghi link ra log để kiểm (khuôn CR-150). Chỉ khi KHÔNG có transport.
    d.log.info("partner-sign-mail-off", { to: to.email, subject: m.subject, link: linkForLog });
    return false;
  }
  try {
    const [res] = await t.sendBatch([
      { idempotencyKey: key, tenantId, to: to.email, toName: to.name ?? "Quý đối tác", ...m },
    ]);
    return res?.ok === true;
  } catch (e) {
    d.log.warn("partner-sign-mail-failed", { error: e instanceof Error ? e.name : "unknown" });
    return false;
  }
}
