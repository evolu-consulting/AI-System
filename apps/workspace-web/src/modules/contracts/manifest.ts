// CR-118 · manifest module "contracts" (Sổ Hợp Tác). Khung rỗng: trỏ tới code hiện có (features/shell/lib/nav); các lát sau dời
// features → modules/contracts/features rồi chuyển nav vào đây. CR-119 phần 2: SHT ở `/contracts/…` (basePath = `/${key}`), home = gốc.
import { NAV, type NavItem } from "~/features/shell/lib/nav";
import { basePathOf } from "~/shared/kernel/app-path";
import type { ModuleManifest } from "~/shared/kernel/module-manifest";

const KEY = "contracts";

export const contractsManifest: ModuleManifest<NavItem> = {
  key: KEY,
  basePath: basePathOf(KEY),
  home: basePathOf(KEY),
  requires: { pack: "contracts", action: "read" },
  nav: NAV,
};
