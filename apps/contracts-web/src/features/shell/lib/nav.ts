// PK-FR-10 · TF5 · 4 mục menu chính (plan-frontend §1 "Menu") và vai suy từ quyền gói (`write`/`owner`).
import type { ComponentType, SVGProps } from "react";
import { IconContract, IconPartners, IconPrices, IconSignature } from "~/components/icons";

export type NavItem = {
  to: "/contracts" | "/partners" | "/prices" | "/cks";
  labelKey: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
};

export const NAV: readonly NavItem[] = [
  { to: "/contracts", labelKey: "contracts.nav.contracts", icon: IconContract },
  { to: "/partners", labelKey: "contracts.nav.partners", icon: IconPartners },
  { to: "/prices", labelKey: "contracts.nav.prices", icon: IconPrices },
  { to: "/cks", labelKey: "contracts.nav.products", icon: IconSignature },
];

export type Role = "owner" | "editor" | "viewer";

export const roleOf = (p: { write: boolean; owner: boolean }): Role =>
  p.owner ? "owner" : p.write ? "editor" : "viewer";

/** Mục chỉ người ghi thấy: "Cài đặt" (chấm điểm đối tác...) — viewer chỉ xem. */
export const canSeeSettings = (r: Role): boolean => r !== "viewer";

/** Mục menu đang chọn theo đường dẫn (`/cks/123` → Sản phẩm). */
export const activeNav = (pathname: string): NavItem | undefined =>
  NAV.find((n) => pathname === n.to || pathname.startsWith(`${n.to}/`));
