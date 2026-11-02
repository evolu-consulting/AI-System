// COM-FR-28/29/43 · mô hình điều hướng Sidebar. Nhóm Sổ Hợp Tác CHỈ có trong mô hình khi chủ quản có quyền gói contracts
// (`caps.contracts`) và server cấp `contractsUrl` (I1/I3, HT-75/76): thiếu quyền ⇒ không có mục nào ⇒ UI không render gì (không CSS ẩn).
import { isOwnProfile, type Route } from "./route";

export type NavIcon = "home" | "edit" | "dashboard" | "doc" | "users" | "box";
export type NavTarget = { kind: "route"; route: Route } | { kind: "contracts"; path: string };
export type NavItem = { id: string; labelKey: string; icon: NavIcon; target: NavTarget };
export type NavGroup = { id: "community" | "sht"; labelKey: string; items: NavItem[] };

export type NavInput = {
  ownOrgId: string;
  caps: { contracts: boolean };
  contractsUrl: string | null;
};

/** Đường dẫn contracts-web của 4 mục Sổ Hợp Tác (mockup hợp nhất). */
export const SHT_PATHS = {
  overview: "/overview",
  contracts: "/contracts",
  partners: "/partners",
  products: "/products",
} as const;

export const hasContractsGroup = (v: Pick<NavInput, "caps" | "contractsUrl">): boolean =>
  v.caps.contracts && v.contractsUrl !== null;

export function buildNav(v: NavInput): NavGroup[] {
  const groups: NavGroup[] = [
    {
      id: "community",
      labelKey: "community.nav.group.community",
      items: [
        {
          id: "feed",
          labelKey: "community.nav.feed",
          icon: "home",
          target: { kind: "route", route: { name: "feed" } },
        },
        {
          id: "myPosts",
          labelKey: "community.nav.myPosts",
          icon: "edit",
          target: { kind: "route", route: { name: "profile", orgId: v.ownOrgId } },
        },
      ],
    },
  ];
  if (hasContractsGroup(v)) {
    const link = (id: keyof typeof SHT_PATHS, icon: NavIcon): NavItem => ({
      id,
      labelKey: `community.nav.sht.${id}`,
      icon,
      target: { kind: "contracts", path: SHT_PATHS[id] },
    });
    groups.push({
      id: "sht",
      labelKey: "community.nav.group.sht",
      items: [
        link("overview", "dashboard"),
        link("contracts", "doc"),
        link("partners", "users"),
        link("products", "box"),
      ],
    });
  }
  return groups;
}

/** Mục route đang sáng? Bảng tin ↔ route feed; "Bài đăng của tôi" ↔ hồ sơ của mình. Link ngoài không bao giờ sáng. */
export function isActive(item: NavItem, route: Route, ownOrgId: string): boolean {
  if (item.target.kind !== "route") return false;
  return item.target.route.name === "feed" ? route.name === "feed" : isOwnProfile(route, ownOrgId);
}

/** Địa chỉ đầy đủ tới contracts-web: gốc (bỏ `/` cuối) + đường dẫn. */
export const contractsHref = (base: string, path: string): string =>
  `${base.replace(/\/+$/, "")}${path}`;
