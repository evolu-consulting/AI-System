// Chọn người xem (D2, chủ quản): nhãn hiển thị + xem trước số công ty nhận được. Đối tác không có picker (chỉ ghi chú).
import type { PartnerOrg, PostAudience, PostType } from "@ai/contracts/community";
import { audienceIncludes, defaultAudience } from "./visibility";

export const AUDIENCE_LABEL: Record<PostAudience["mode"], string> = {
  all: "Tất cả bạn bè",
  suppliers: "Chỉ nhà cung cấp",
  buyers: "Chỉ người mua",
  cats: "Theo nhóm hàng",
  companies: "Từng công ty",
};

export const PARTNER_NOTE = "Chỉ chủ quản thấy bài này";

/** Công ty (chưa rời) sẽ thấy bài với audience này — trần là bạn bè nên chỉ xét danh sách đối tác. */
export function previewRecipients(
  a: PostAudience | undefined,
  type: PostType,
  postCats: string[],
  partners: PartnerOrg[],
): PartnerOrg[] {
  const aud = a ?? defaultAudience(type);
  return partners.filter(
    (p) =>
      !p.left &&
      audienceIncludes(aud, type, postCats, { orgId: p.id, labels: p.labels, cats: p.cats }),
  );
}

export function audienceSummary(a: PostAudience | undefined, type: PostType): string {
  const aud = a ?? defaultAudience(type);
  if (aud.mode === "cats") {
    return aud.cats.length > 0
      ? `Nhóm hàng: ${aud.cats.join(", ")}`
      : type === "sell"
        ? "Người mua quan tâm nhóm hàng của bài"
        : type === "buy"
          ? "Nhà cung cấp nhóm hàng của bài"
          : "Đối tác quan tâm nhóm hàng của bài";
  }
  if (aud.mode === "companies") return `${aud.companies.length} công ty được chọn`;
  return AUDIENCE_LABEL[aud.mode];
}

/** Câu xem trước dưới picker: "Sẽ hiện với 3 công ty: A, B, C". */
export function previewText(recipients: PartnerOrg[]): string {
  if (recipients.length === 0) return "Chưa có công ty nào thấy bài này";
  const names = recipients
    .slice(0, 3)
    .map((r) => r.name)
    .join(", ");
  const more = recipients.length > 3 ? ` và ${recipients.length - 3} công ty khác` : "";
  return `Sẽ hiện với ${recipients.length} công ty: ${names}${more}`;
}

/** Audience hợp lệ để gửi: chế độ cats/companies phải có ít nhất một lựa chọn (cats bỏ trống = dùng nhóm hàng của bài, cho phép). */
export function audienceError(a: PostAudience): string | null {
  if (a.mode === "companies" && a.companies.length === 0) return "Chọn ít nhất một công ty";
  return null;
}
