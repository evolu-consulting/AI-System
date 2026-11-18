// CR-182 · gửi thư cho đối tác qua transport email chung của thông báo (hoặc ghi link ra log khi `HUB_NOTIFY_MODE=off`).

import type { PartnerSignDeps } from "./partner-sign.deps";
import type { ContactRow } from "./partner-sign.repo.port";

/** Thư (hoặc log khi tắt thông báo). Không ném: lỗi gửi ⇒ link vẫn có (người tải lên bấm «Gửi lại»). */
export async function sendMail(
  d: Pick<PartnerSignDeps, "mailer" | "log" | "logLink">,
  tenantId: string,
  to: ContactRow,
  key: string,
  m: { subject: string; text: string; html?: string },
  linkForLog: string | null,
  linkId: string | null,
): Promise<boolean> {
  const t = d.mailer();
  if (!to.email) {
    d.log.warn("partner-sign-mail-no-email", {});
    return false;
  }
  if (!t) {
    // HUB_NOTIFY_MODE=off. Link /ky/<token> đủ để ký thay đối tác ⇒ chỉ bản dev/test mới ghi ra log (khuôn CR-150);
    // prod chỉ ghi `link_id` — người tải lên lấy link qua «Sao chép link» (route đã đăng nhập).
    if (d.logLink())
      d.log.info("partner-sign-mail-off", {
        to: to.email,
        subject: m.subject,
        link: linkForLog,
        link_id: linkId,
      });
    else d.log.info("partner-sign-mail-off", { link_id: linkId });
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
