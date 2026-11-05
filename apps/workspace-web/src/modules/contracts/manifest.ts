// CR-118 · manifest module "contracts" (Sổ Hợp Tác). Khung rỗng: trỏ tới code hiện có (features/shell/lib/nav); các lát sau dời
// features → modules/contracts/features rồi chuyển nav vào đây. Không đổi hành vi.
import { NAV, type NavItem } from "~/features/shell/lib/nav";
import type { ModuleManifest } from "~/shared/kernel/module-manifest";

export const contractsManifest: ModuleManifest<NavItem> = {
  key: "contracts",
  home: "/overview",
  requires: { pack: "contracts", action: "read" },
  nav: NAV,
};
