// CR-118 · manifest module "contracts" (Sổ Hợp Tác). Khung rỗng: trỏ tới code hiện có (features/shell/lib/nav); các lát sau dời
// features → modules/contracts/features rồi chuyển nav vào đây. CR-119 phần 2: SHT ở `/contracts/…` (basePath = `/${key}`), home = gốc.
import { APPROVALS_NAV, NAV, type NavItem, PARTNER_INBOX_NAV } from "~/features/shell/lib/nav";
import { basePathOf } from "~/shared/kernel/app-path";
import type { ModuleManifest } from "~/shared/kernel/module-manifest";

const KEY = "contracts";

export const contractsManifest: ModuleManifest<NavItem> = {
  key: KEY,
  basePath: basePathOf(KEY),
  home: basePathOf(KEY),
  requires: { pack: "contracts", action: "read" },
  groupLabelKey: "contracts.nav.group.contracts",
  order: 10,
  // C-7: "Chờ tôi duyệt" đứng sau "Hợp đồng"; mục có `cap` nên chỉ hiện khi server báo người dùng có vai duyệt.
  nav: [...NAV.slice(0, 2), APPROVALS_NAV, ...NAV.slice(2, 3), PARTNER_INBOX_NAV, ...NAV.slice(3)],
};
