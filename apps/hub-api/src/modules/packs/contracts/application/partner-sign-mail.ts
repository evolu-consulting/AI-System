// CR-182 · gửi thư cho đối tác qua transport email chung của thông báo (hoặc ghi link ra log khi `HUB_NOTIFY_MODE=off`).

import type { PartnerSignDeps } from "./partner-sign.deps";
import type { ContactRow } from "./partner-sign.repo.port";

type Res = { ok: true } | { ok: false; permanent: boolean; code: string; skip?: boolean };
/** Thư KHÔNG đi (miền dành riêng như .invalid, SMTP từ chối…): trước đây im lặng ⇒ HĐ chờ đối tác mà không ai biết. Ghi rõ lý do; bản dev/test
 *  ghi thêm link để lấy tay (chỉ khi miền bị bỏ qua — địa chỉ thật không bao giờ bị `skip`). */
function logUndelivered(
  d: Pick<PartnerSignDeps, "log" | "logLink">,
  res: Res | undefined,
  linkId: string | null,
  link: string | null,
): void {
  const bad = res && !res.ok ? res : null;
  d.log.warn("partner-sign-mail-undelivered", {
    link_id: linkId,
    code: bad?.code ?? "no_result",
    skip: bad?.skip === true,
    permanent: bad?.permanent ?? false,
    ...(d.logLink() && bad?.skip ? { link } : {}),
  });
}

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
    if (res?.ok === true) return true;
    logUndelivered(d, res, linkId, linkForLog);
    return false;
  } catch (e) {
    d.log.warn("partner-sign-mail-failed", { error: e instanceof Error ? e.name : "unknown" });
    return false;
  }
}
