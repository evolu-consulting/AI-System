// Chọn người xem (D2, chủ quản): nhãn hiển thị + xem trước số công ty nhận được. Đối tác không có picker (chỉ ghi chú).
import type { PartnerOrg, PostAudience, PostType } from "@ai/contracts/community";
import { t } from "../i18n";
import { catsSummary } from "./cat-pick";
import { audienceIncludes, defaultAudience } from "./visibility";

export const audienceLabel = (mode: PostAudience["mode"]): string =>
  t(`community.audience.${mode}`);

export const partnerNote = (): string => t("community.audience.partnerNote");

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
      ? t("community.audience.catsList", { list: catsSummary(aud.cats) })
      : type === "sell"
        ? t("community.audience.catsSell")
        : type === "buy"
          ? t("community.audience.catsBuy")
          : t("community.audience.catsNote");
  }
  if (aud.mode === "companies")
    return t("community.audience.companiesCount", { n: aud.companies.length + aud.tenants.length });
  return audienceLabel(aud.mode);
}

/** Câu xem trước dưới picker: "Sẽ hiện với 3 công ty: A, B, C". */
export function previewText(recipients: PartnerOrg[]): string {
  if (recipients.length === 0) return t("community.audience.previewNone");
  const names = recipients
    .slice(0, 3)
    .map((r) => r.name)
    .join(", ");
  const more =
    recipients.length > 3 ? t("community.audience.previewMore", { n: recipients.length - 3 }) : "";
  return t("community.audience.preview", { n: recipients.length, names, more });
}

/** CR-191 · «n/N công ty đối tác thấy bài»: đối tác trong cộng đồng (chưa rời) + công ty đã kết nối. */
export function audienceCounts(
  a: PostAudience,
  post: { type: PostType; cats: string[] },
  partners: PartnerOrg[],
  connected: readonly { sees: boolean }[],
): { n: number; N: number } {
  const { type, cats: postCats } = post;
  return {
    n:
      previewRecipients(a, type, postCats, partners).length +
      connected.filter((c) => c.sees).length,
    N: partners.filter((p) => !p.left).length + connected.length,
  };
}

/** CR-191 · «Thêm công ty vào»: chuyển «Ai thấy bài» sang «Chọn công ty» có thêm công ty đó (giữ các công ty đã chọn). */
export function addCompany(a: PostAudience, tenantId: string): PostAudience {
  return {
    ...a,
    mode: "companies",
    tenants: a.mode === "companies" ? [...new Set([...a.tenants, tenantId])] : [tenantId],
    companies: a.mode === "companies" ? a.companies : [],
  };
}

/** Audience hợp lệ để gửi: chế độ cats/companies phải có ít nhất một lựa chọn (cats bỏ trống = dùng nhóm hàng của bài, cho phép). */
export function audienceError(a: PostAudience): string | null {
  if (a.mode === "companies" && a.companies.length === 0 && a.tenants.length === 0)
    return t("community.audience.errorPickOne");
  return null;
}
