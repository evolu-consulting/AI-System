// PK-FR-10 · TF5 · nav-v2 (người dùng chốt 2026-10-20): 4 mục menu — Tổng quan · Hợp đồng · Đối tác · Sản phẩm & Giá — theo mockup NITI;
// vai suy từ quyền gói (`write`/`owner`). CR-119 p2: mọi đường dẫn dưới `/contracts`; tuyến cũ chuyển hướng bằng shared/kernel/legacy-routes.
import { ClipboardCheck, Inbox } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { IconBox, IconContract, IconOverview, IconPartners } from "~/components/icons";
import { basePathOf } from "~/shared/kernel/app-path";

/** CR-119 phần 2: SHT dưới `/contracts` (basePath = `/${key}`). */
const B = basePathOf("contracts");

export type NavItem = {
  to:
    | "/contracts"
    | "/contracts/list"
    | "/contracts/approvals"
    | "/contracts/partner-inbox"
    | "/contracts/partners"
    | "/contracts/products";
  labelKey: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  testId?: string;
  /** CR-121 C-7 · khoá quyền động (server tính, shell/use-flow-caps): có ⇒ chỉ hiện khi đúng. */
  cap?: string;
  /** Chỉ sáng khi path đúng bằng `to` (Tổng quan = gốc app, mọi trang khác nằm dưới nó). */
  exact?: true;
  /** Tiền tố con cũng thuộc mục này (chi tiết `/contracts/c/<id>` → "Hợp đồng"). */
  also?: readonly string[];
};

export const NAV: readonly NavItem[] = [
  { to: B, labelKey: "contracts.nav.overview", icon: IconOverview, exact: true },
  { to: `${B}/list`, labelKey: "contracts.nav.contracts", icon: IconContract, also: [`${B}/c`] },
  { to: `${B}/partners`, labelKey: "contracts.nav.partners", icon: IconPartners },
  { to: `${B}/products`, labelKey: "contracts.nav.products", icon: IconBox },
];
/** CR-121 C-7 · mục "Chờ tôi duyệt" (cap `contracts.review`): chỉ người có vai duyệt trong quy trình đang gán. Ngoài `NAV` (mục luôn hiện). */
export const APPROVALS_NAV: NavItem = {
  to: `${B}/approvals`,
  labelKey: "contracts.nav.approvals",
  icon: ClipboardCheck,
  testId: "nav-contracts-approvals",
  cap: "contracts.review",
};
/** CR-124 · q4 · mục «Hợp đồng đối tác gửi» (cap `contracts.partner`): chỉ hiện khi công ty bật tính năng gửi/nhận HĐ đối tác. */
export const PARTNER_INBOX_NAV: NavItem = {
  to: `${B}/partner-inbox`,
  labelKey: "contracts.nav.partner-inbox",
  icon: Inbox,
  testId: "nav-contracts-partner-inbox",
  cap: "contracts.partner",
};
export type Role = "owner" | "editor" | "viewer";

export const roleOf = (p: { write: boolean; owner: boolean }): Role =>
  p.owner ? "owner" : p.write ? "editor" : "viewer";

/** Mục chỉ người ghi thấy: "Cài đặt" (chấm điểm đối tác...) — viewer chỉ xem. */
/** B8: người đọc chỉ xem; quản trị công ty (tenant_admin / platform_admin) luôn mở được Thành viên & phòng ban. */
export const isCompanyAdmin = (tenantRole: string | undefined): boolean =>
  tenantRole === "tenant_admin" || tenantRole === "platform_admin";
export const canSeeSettings = (r: Role, tenantRole?: string): boolean =>
  r !== "viewer" || isCompanyAdmin(tenantRole);

const under = (pathname: string, prefix: string): boolean =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

/** Mục menu đang chọn theo đường dẫn (`/contracts/c/123` → Hợp đồng). Tuyến SHT cũ ở gốc đã được chuyển hướng (shared/kernel/legacy-routes). */
export function activeNav(pathname: string): NavItem | undefined {
  return NAV.find((n) =>
    n.exact
      ? pathname === n.to
      : under(pathname, n.to) || (n.also ?? []).some((a) => under(pathname, a)),
  );
}

/** Bố cục vùng nội dung: danh sách đầy cột (`board`, rộng 1600 px, tự giữ cuộn từ md), Tổng quan (`wide`), còn lại `reading`. */
export type PageLayout = "board" | "wide" | "reading";
export function layoutOf(pathname: string): PageLayout {
  if (pathname === B) return "wide";
  // CR-120: Community (Bảng tin 3 cột / Hồ sơ) trong cùng khung ⇒ khoang rộng như Tổng quan.
  if (pathname === "/community" || pathname.startsWith("/community/")) return "wide";
  return [`${B}/list`, `${B}/partners`, `${B}/products`].includes(pathname) ? "board" : "reading";
}
