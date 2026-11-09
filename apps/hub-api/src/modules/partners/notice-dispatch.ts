// CR-126 · «Vào app + email báo» · bộ gửi thư BÁO cho người nhận đã chọn khi bên nhận ĐÃ trên nền tảng (kênh nền tảng, dòng có `to_email`). Cùng khung
// với `email-dispatch.ts` và dùng CÙNG transport email chung của thông báo (null khi `HUB_NOTIFY_MODE` tắt ⇒ không gửi, dòng nằm chờ). Một lượt =
// (1) tx system: thuê lô; (2) MỘT `sendBatch`; (3) tx system: chốt cả lô ⇒ số câu SQL cố định. Mẫu thư do GÓI cung cấp (`PartnerMailboxPort.notice`);
// nút trong thư dẫn vào hộp thư đối tác trong app (đăng nhập) — không token, không đính hợp đồng. Mỗi dòng (= một vòng gửi) báo đúng một lần.
import { withHubScope } from "@ai/db/hub-scope";
import type { EmailSettle } from "./adapters/email.repo";
import { type ClaimedNotice, claimNotices, settleNotices } from "./adapters/notice.repo";
import { EMAIL_BATCH, EMAIL_LEASE_S } from "./domain/email-link.rules";
import type { MailOut, PartnerEmailDeps, PartnerEmailStats } from "./email-dispatch.types";

const SYS = { kind: "system" as const };
/** Hộp thư đối tác trong app Hợp đồng (đường dẫn của `workspace-web`). */
export const PARTNER_INBOX_PATH = "/contracts/partner-inbox";

const text = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

function mailOf(
  d: PartnerEmailDeps,
  make: NonNullable<NonNullable<ReturnType<PartnerEmailDeps["port"]>>["notice"]>,
  r: ClaimedNotice,
): MailOut {
  const p = r.payload ?? {};
  const m = make({
    senderName: text(p.sender_name) ?? "",
    title: text(p.title) ?? "Hợp đồng",
    message: text(p.message),
    round: r.round,
    expiresAt: new Date(r.expires_at),
    link: `${d.baseUrl.replace(/\/+$/, "")}${PARTNER_INBOX_PATH}`,
  });
  return {
    idempotencyKey: `partner-notice-${r.id}-${r.attempts}`,
    tenantId: r.from_tenant,
    to: r.to_email,
    toName: "Quý đối tác",
    subject: m.subject,
    text: m.text,
    html: m.html,
  };
}

export async function partnerNoticeOnce(d: PartnerEmailDeps): Promise<PartnerEmailStats> {
  const transport = d.email();
  if (!transport) return { claimed: 0, sent: 0, failed: 0 };
  const rows = await withHubScope(d.db, SYS, (tx) =>
    claimNotices(tx, d.batch ?? EMAIL_BATCH, EMAIL_LEASE_S),
  );
  if (rows.length === 0) return { claimed: 0, sent: 0, failed: 0 };
  const make = d.port()?.notice;
  const settle: EmailSettle[] = [];
  const ready: { id: string; msg: MailOut }[] = [];
  for (const r of rows) {
    // Gói chưa đăng ký mẫu (chưa mount) ⇒ lỗi tạm: dòng nghỉ theo bậc thang rồi thử lại, không mất.
    if (!make)
      settle.push({
        id: r.id,
        ok: false,
        permanent: false,
        err: "notice_template_missing",
        sha: null,
      });
    else ready.push({ id: r.id, msg: mailOf(d, make, r) });
  }
  if (ready.length > 0) {
    let results: Awaited<ReturnType<typeof transport.sendBatch>> | null = null;
    let thrown = "send_failed";
    try {
      results = await transport.sendBatch(ready.map((x) => x.msg));
    } catch (err) {
      thrown = err instanceof Error ? err.name : "send_failed";
    }
    ready.forEach((x, i) => {
      const r = results?.[i];
      if (r?.ok) settle.push({ id: x.id, ok: true, permanent: false, err: null, sha: null });
      else if (r)
        settle.push({
          id: x.id,
          ok: false,
          permanent: r.permanent || r.skip === true,
          err: r.code,
          sha: null,
        });
      else settle.push({ id: x.id, ok: false, permanent: false, err: thrown, sha: null });
    });
  }
  await withHubScope(d.db, SYS, (tx) => settleNotices(tx, settle));
  const sent = settle.filter((s) => s.ok).length;
  return { claimed: rows.length, sent, failed: settle.length - sent };
}
