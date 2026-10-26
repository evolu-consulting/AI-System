// PK-FR-10 · TF5 · nav-v2 (người dùng chốt 2026-10-20): 4 mục menu — Tổng quan · Hợp đồng · Đối tác · Sản phẩm & Giá — theo mockup NITI;
// vai suy từ quyền gói (`write`/`owner`). Tuyến cũ (/my-work, /prices, /cks, /sourcing) chuyển hướng vào Tổng quan / Sản phẩm & Giá.
import type { ComponentType, SVGProps } from "react";
import {
  IconBox,
  IconContract,
  IconOverview,
  IconPartners,
  IconTransaction,
} from "~/components/icons";

export type NavItem = {
  to: "/overview" | "/contracts" | "/transactions" | "/partners" | "/products";
  labelKey: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
};

export const NAV: readonly NavItem[] = [
  { to: "/overview", labelKey: "contracts.nav.overview", icon: IconOverview },
  { to: "/contracts", labelKey: "contracts.nav.contracts", icon: IconContract },
  // CR-097 G2: Giao dịch nhập tay (cạnh Hợp đồng).
  { to: "/transactions", labelKey: "contracts.nav.transactions", icon: IconTransaction },
  { to: "/partners", labelKey: "contracts.nav.partners", icon: IconPartners },
  { to: "/products", labelKey: "contracts.nav.products", icon: IconBox },
];

export type Role = "owner" | "editor" | "viewer";

export const roleOf = (p: { write: boolean; owner: boolean }): Role =>
  p.owner ? "owner" : p.write ? "editor" : "viewer";

/** Mục chỉ người ghi thấy: "Cài đặt" (chấm điểm đối tác...) — viewer chỉ xem. */
/** B8: người đọc chỉ xem; quản trị công ty (tenant_admin / platform_admin) luôn mở được Thành viên & phòng ban. */
export const isCompanyAdmin = (tenantRole: string | undefined): boolean =>
  tenantRole === "tenant_admin" || tenantRole === "platform_admin";
export const canSeeSettings = (r: Role, tenantRole?: string): boolean =>
  r !== "viewer" || isCompanyAdmin(tenantRole);

/** Tuyến cũ vẫn còn làm chuyển hướng (và `/cks/$id`, chi tiết khách) → mục menu chứa nó. */
const LEGACY: readonly [prefix: string, to: NavItem["to"]][] = [
  ["/cks", "/products"],
  ["/prices", "/products"],
  ["/sourcing", "/products"],
  ["/my-work", "/overview"],
];

const under = (pathname: string, prefix: string): boolean =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

/** Mục menu đang chọn theo đường dẫn (`/cks/123` → Sản phẩm & Giá). */
export function activeNav(pathname: string): NavItem | undefined {
  const hit = NAV.find((n) => under(pathname, n.to));
  if (hit) return hit;
  const to = LEGACY.find(([p]) => under(pathname, p))?.[1];
  return NAV.find((n) => n.to === to);
}

/** Bố cục vùng nội dung: danh sách đầy cột (`board`, rộng 1600 px, tự giữ cuộn từ md), Tổng quan (`wide`), còn lại `reading`. */
export type PageLayout = "board" | "wide" | "reading";
export function layoutOf(pathname: string): PageLayout {
  if (pathname === "/overview") return "wide";
  return ["/contracts", "/transactions", "/partners", "/products"].includes(pathname)
    ? "board"
    : "reading";
}
