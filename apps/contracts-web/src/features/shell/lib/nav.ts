// PK-FR-10 · TF5 · 4 mục menu chính (plan-frontend §1 "Menu") và vai suy từ quyền gói (`write`/`owner`).
import type { ComponentType, SVGProps } from "react";
import {
  IconBell,
  IconContract,
  IconPartners,
  IconPayments,
  IconPrices,
  IconSignature,
} from "~/components/icons";

export type NavItem = {
  to: "/contracts" | "/partners" | "/prices" | "/cks" | "/my-work" | "/sourcing";
  /** W1: mục thêm so với mgmt-app (ẩn ở cảnh so ảnh, xem DEVIATIONS.md). */
  extra?: true;
  labelKey: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
};

export const NAV: readonly NavItem[] = [
  { to: "/contracts", labelKey: "contracts.nav.contracts", icon: IconContract },
  { to: "/partners", labelKey: "contracts.nav.partners", icon: IconPartners },
  { to: "/prices", labelKey: "contracts.nav.prices", icon: IconPrices },
  { to: "/cks", labelKey: "contracts.nav.products", icon: IconSignature },
  { to: "/my-work", labelKey: "contracts.work.nav", icon: IconBell, extra: true },
  { to: "/sourcing", labelKey: "contracts.sourcing.nav", icon: IconPayments, extra: true },
];

export type Role = "owner" | "editor" | "viewer";

export const roleOf = (p: { write: boolean; owner: boolean }): Role =>
  p.owner ? "owner" : p.write ? "editor" : "viewer";

/** 4 mục menu chính của mgmt-app (menu desktop + thanh dưới mobile). */
export const MAIN_NAV: readonly NavItem[] = NAV.filter((n) => !n.extra);
/** Mục thêm của W1: nhóm "Tiện ích" riêng, không nằm trong menu chính / thanh dưới. */
export const EXTRA_NAV: readonly NavItem[] = NAV.filter((n) => n.extra);

/** Mục chỉ người ghi thấy: "Cài đặt" (chấm điểm đối tác...) — viewer chỉ xem. */
/** B8: người đọc chỉ xem; quản trị công ty (tenant_admin / platform_admin) luôn mở được Thành viên & phòng ban. */
export const isCompanyAdmin = (tenantRole: string | undefined): boolean =>
  tenantRole === "tenant_admin" || tenantRole === "platform_admin";
export const canSeeSettings = (r: Role, tenantRole?: string): boolean =>
  r !== "viewer" || isCompanyAdmin(tenantRole);

/** Mục menu đang chọn theo đường dẫn (`/cks/123` → Sản phẩm). */
export const activeNav = (pathname: string): NavItem | undefined =>
  NAV.find((n) => pathname === n.to || pathname.startsWith(`${n.to}/`));

/** Trang danh sách đầy cột (mgmt-app `Shell.tsx:119-122`): rộng tới 1600 px, tự giữ thanh cuộn dọc (thanh công cụ + phân trang đứng yên) từ md. */
export type PageLayout = "board" | "wide" | "reading";
export function layoutOf(pathname: string, searchStr: string): PageLayout {
  const pricesCks =
    pathname === "/prices" && (new URLSearchParams(searchStr).get("product") ?? "cks") === "cks";
  if (pricesCks) return "wide";
  return ["/contracts", "/partners", "/prices", "/cks", "/sourcing"].includes(pathname)
    ? "board"
    : "reading";
}
