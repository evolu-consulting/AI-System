// CR-182 · đợt 2 · luật thuần (lớp 1) của «Đối tác ký qua link riêng» (BR-C5). Không I/O (băm/ngẫu nhiên dùng Web Crypto chuẩn).
// Token 256-bit chỉ nằm trong email + URL; DB chỉ giữ băm SHA-256 (cùng khuôn `partners/domain/email-link.rules.ts` — gói không import module hub).
import {
  PARTNER_LINK_DEFAULT_DAYS,
  type PartnerLinkState,
  type PartnerLinkStatusOut,
  type SignParts,
} from "@ai/contracts/pack-contracts";

export const SIGN_LINK_PATH = "/ky";

export type LinkStatusIn = {
  state: PartnerLinkState;
  sent_at: Date | string | null;
  opened_at: Date | string | null;
  expires_at: Date | string;
  signed_at: Date | string | null;
  declined_at: Date | string | null;
  decline_reason: string | null;
  contact_name: string | null;
};
const isoOf = (d: Date | string | null): string | null => (d ? new Date(d).toISOString() : null);
/** Trạng thái link phía công ty thấy (không lộ email/băm). */
export const statusOut = (r: LinkStatusIn): PartnerLinkStatusOut => ({
  state: r.state,
  sent_at: isoOf(r.sent_at),
  opened_at: isoOf(r.opened_at),
  expires_at: new Date(r.expires_at).toISOString(),
  signed_at: isoOf(r.signed_at),
  declined_at: isoOf(r.declined_at),
  decline_reason: r.decline_reason,
  contact_name: r.contact_name,
});
const DAY_MS = 86_400_000;

export const newLinkToken = (): string =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

export async function hashLinkToken(token: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  return Array.from(d, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** Link gửi trong email: `<APP_URL>/ky/<token>` (trang công khai của workspace-web). */
export const signLinkUrl = (baseUrl: string, token: string): string =>
  `${baseUrl.replace(/\/+$/, "")}${SIGN_LINK_PATH}/${token}`;

/** Hạn link = hạn của bước (nếu còn ở tương lai) ngược lại mặc định 7 ngày kể từ bây giờ. */
export function linkExpiry(stepDueAt: Date | string | null | undefined, now: Date): Date {
  const due = stepDueAt ? new Date(stepDueAt) : null;
  return due && !Number.isNaN(due.getTime()) && due.getTime() > now.getTime()
    ? due
    : new Date(now.getTime() + PARTNER_LINK_DEFAULT_DAYS * DAY_MS);
}

type LinkTimes = {
  signed_at: Date | string | null;
  declined_at: Date | string | null;
  revoked_at: Date | string | null;
  expires_at: Date | string;
};
/** Trạng thái link (khớp hàm DEFINER `partner_sign_link_open`): thu hồi > đã ký > từ chối > hết hạn > mở. */
export function linkState(l: LinkTimes, now: Date): PartnerLinkState {
  if (l.revoked_at) return "revoked";
  if (l.signed_at) return "signed";
  if (l.declined_at) return "declined";
  return new Date(l.expires_at).getTime() <= now.getTime() ? "expired" : "open";
}

/** Link còn dùng được để ký (không còn: 410 — hết hạn/thu hồi; 409 — đã ký/từ chối). */
export function linkAccess(state: PartnerLinkState): "ok" | "gone" | "closed" {
  if (state === "open") return "ok";
  return state === "signed" || state === "declined" ? "closed" : "gone";
}

/** Gửi lại link: người tải lên HĐ hoặc quản trị công ty (BR-G1). */
export const canResendLink = (c: {
  userId: string;
  uploaderId: string | null;
  isAdmin: boolean;
}): boolean => c.isAdmin || (c.uploaderId !== null && c.uploaderId === c.userId);

/** Liên hệ đầu tiên có email (khớp thứ tự `sign-doc.repo.partner`). */
export const firstEmailContact = <T extends { email: string | null }>(cs: readonly T[]): T | null =>
  cs.find((c) => c.email !== null && c.email.trim() !== "") ?? null;

type FieldB = { id: string; side: string; file_id: string; signed_version_id: string | null };
type MarkIn = { placement: string; field_id?: string | undefined; parts: SignParts };

/**
 * Dấu của đối tác: vào ô (`field`) phải là chỗ Bên B CHƯA ký của ĐÚNG tệp; tự đặt thêm (`free`/`seam`/`initials`) được, nhưng không kèm `field_id`.
 * `forbidden` ⇒ 403 (ô Bên A / ô của tệp khác / đã ký); `invalid` ⇒ 422 (lệch kiểu, trùng).
 */
export function partnerMarksIssue(
  marks: readonly MarkIn[],
  fields: readonly FieldB[],
  fileId: string,
): "forbidden" | "invalid" | null {
  const seen = new Set<string>();
  for (const m of marks) {
    if ((m.placement === "field") !== (m.field_id !== undefined)) return "invalid";
    if (!m.field_id) continue;
    if (seen.has(m.field_id)) return "invalid";
    seen.add(m.field_id);
    const f = fields.find((x) => x.id === m.field_id);
    if (f?.side !== "B" || f.file_id !== fileId || f.signed_version_id !== null) return "forbidden";
  }
  return null;
}

/** Số chỗ ký Bên B chưa ký (mọi tệp cần ký). */
export const partnerOpenFields = (fields: readonly FieldB[]): number =>
  fields.filter((f) => f.side === "B" && f.signed_version_id === null).length;

/** Nhãn người ký đối tác trên bản ký/hồ sơ: «Đối tác: <tên liên hệ>». */
export const partnerLabel = (contactName: string | null, partnerName: string | null): string =>
  `Đối tác: ${(contactName?.trim() || partnerName?.trim() || "Người đại diện").slice(0, 280)}`;

/** HĐ có phải chờ đối tác? ⇒ bên A đã ký đủ (`aDone`) VÀ còn chỗ ký Bên B chưa ký. */
export const needsPartnerStep = (aDone: boolean, bTotal: number, bOpen: number): boolean =>
  aDone && bTotal > 0 && bOpen > 0;

/** Bước Ký xong (HĐ «Đã ký»): bên A đủ VÀ (không có chỗ Bên B, hoặc Bên B đã ký hết). */
export const signStepDone = (
  a: { total: number; open: number },
  b: { total: number; open: number },
) => a.total > 0 && a.open === 0 && b.open === 0;

type MailIn = {
  companyName: string;
  contractTitle: string;
  files: number;
  fields: number;
  expiresAt: Date;
  link: string;
};
const VN_OFFSET = 7 * 3_600_000;
const p2 = (n: number) => String(n).padStart(2, "0");
const vnDate = (d: Date) => {
  const t = new Date(d.getTime() + VN_OFFSET);
  return `${p2(t.getUTCDate())}/${p2(t.getUTCMonth() + 1)}/${t.getUTCFullYear()}`;
};
const clean = (s: string, max: number) =>
  s
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, max);
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Email «Mời ký»: tên công ty A, tên HĐ, số tệp, số chỗ ký, hạn, link riêng. */
export function inviteMail(i: MailIn): { subject: string; text: string; html: string } {
  const co = clean(i.companyName || "Một công ty đối tác", 200);
  const title = clean(i.contractTitle, 200);
  const deadline = vnDate(i.expiresAt);
  const subject = clean(`${co} mời Quý đối tác ký hợp đồng "${title}"`, 200);
  const what = `${i.files} tệp cần ký, ${i.fields} chỗ ký`;
  const text = [
    "Kính gửi Quý đối tác,",
    "",
    `${co} đã ký xong và mời Quý công ty ký hợp đồng "${title}" (${what}).`,
    `Hạn ký: ${deadline}`,
    "Mở hợp đồng và ký (không cần tài khoản):",
    i.link,
    "",
    "Đường dẫn dành riêng cho thư này, vui lòng không chuyển tiếp.",
    "Nếu Quý vị không liên quan đến hợp đồng này, xin bỏ qua thư.",
  ].join("\n");
  const html = `<!doctype html><html lang="vi"><body style="font-family:Segoe UI,Arial,sans-serif;color:#1b2430"><p>Kính gửi Quý đối tác,</p><p><b>${esc(co)}</b> đã ký xong và mời Quý công ty ký hợp đồng <b>${esc(title)}</b> (${esc(what)}).</p><p>Hạn ký: <b>${esc(deadline)}</b></p><p><a href="${esc(i.link)}" style="display:inline-block;background:#1f5fbf;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px">Mở hợp đồng và ký</a></p><p style="font-size:12px;color:#5b6675">Không cần tài khoản. Đường dẫn dành riêng cho thư này, vui lòng không chuyển tiếp. Nếu Quý vị không liên quan đến hợp đồng này, xin bỏ qua thư.</p></body></html>`;
  return { subject, text, html };
}

/** Email «Đã ký»: gửi đối tác kèm bản đã ký (đính kèm do bộ gửi) — chỉ lời. */
export function signedMail(i: { companyName: string; contractTitle: string; files: number }): {
  subject: string;
  text: string;
} {
  const co = clean(i.companyName || "Công ty đối tác", 200);
  const title = clean(i.contractTitle, 200);
  return {
    subject: clean(`Hợp đồng "${title}" đã ký xong`, 200),
    text: `Kính gửi Quý đối tác,\n\nHợp đồng "${title}" của ${co} đã được ký đủ hai bên. Quý vị có thể mở lại đường dẫn trong thư mời ký để xem và tải bản đã ký (${i.files} tệp).\n\nXin cảm ơn.`,
  };
}
