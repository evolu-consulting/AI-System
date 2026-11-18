// CR-182 · trạng thái link ký của đối tác ở trang HĐ (hàm thuần): có cho «Gửi lại link» không, các dòng «nhãn: giá trị».
import type { PartnerLinkStatusOut, SignSessionOut } from "@ai/contracts/pack-contracts";
import { fmtDateTime } from "~/features/partner-sign/lib/partner-map";

export type PartnerLinkLine = { key: "sentAt" | "openedAt" | "due"; value: string | null };

/** Link đang chờ / bị từ chối / hết hạn / thu hồi ⇒ gửi lại được. Đã ký ⇒ không còn gì để gửi. */
export const canShowResend = (l: PartnerLinkStatusOut | null | undefined): boolean =>
  !!l && l.state !== "signed";

/** Người tải lên tệp chính hoặc quản trị đều có `can_prep` trên tệp ⇒ hiện nút; máy chủ vẫn kiểm lại (403 ⇒ câu báo). */
export const canResend = (s: SignSessionOut): boolean => s.files.some((f) => f.can_prep);

/** `value` null ở «đã mở» = chưa mở (giao diện ghi «Chưa mở»). Hạn chỉ hiện khi link còn chờ. */
export function linkLines(l: PartnerLinkStatusOut, lang: string): PartnerLinkLine[] {
  const out: PartnerLinkLine[] = [];
  if (l.sent_at) out.push({ key: "sentAt", value: fmtDateTime(l.sent_at, lang) });
  out.push({ key: "openedAt", value: l.opened_at ? fmtDateTime(l.opened_at, lang) : null });
  if (l.state === "open") out.push({ key: "due", value: fmtDateTime(l.expires_at, lang) });
  return out;
}
