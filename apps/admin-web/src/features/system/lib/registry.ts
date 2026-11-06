// CR-121 · c22 · MỘT nguồn danh sách lối vào của màn "Hệ thống" (`/system`): trang hub đọc từ đây.
// Lọc theo vai giống quyền của route đích: platform_admin thấy hết; tenant_admin thấy Chi phí · Nhật ký · Góp ý · Nguồn
// (API đích tự ép công ty của họ: usage/feedback/audit/sources). Module đóng băng (Nguồn, Import/Export) ẩn khi cờ tắt.
import type { Role } from "@ai/contracts/common";
import { isFrozenPath } from "@/features/shell/lib/nav";

export type SystemEntryId =
  | "usage"
  | "audit"
  | "feedback"
  | "health"
  | "features"
  | "secrets"
  | "sources"
  | "dlcSteps"
  | "transfer";
export type SystemTo =
  | "/usage"
  | "/audit"
  | "/feedback"
  | "/system-health"
  | "/features"
  | "/secrets"
  | "/sources"
  | "/dlc-steps"
  | "/transfer";
export type SystemEntry = {
  id: SystemEntryId;
  to: SystemTo;
  labelKey: `nav.${string}` | "system.title";
  descKey: `system.hub.${SystemEntryId}`;
  roles: readonly Role[];
};

const BOTH: readonly Role[] = ["platform_admin", "tenant_admin"];
const PLATFORM: readonly Role[] = ["platform_admin"];

export const SYSTEM_ENTRIES: readonly SystemEntry[] = [
  { id: "usage", to: "/usage", labelKey: "nav.usage", descKey: "system.hub.usage", roles: BOTH },
  { id: "audit", to: "/audit", labelKey: "nav.audit", descKey: "system.hub.audit", roles: BOTH },
  {
    id: "feedback",
    to: "/feedback",
    labelKey: "nav.feedback",
    descKey: "system.hub.feedback",
    roles: BOTH,
  },
  {
    id: "health",
    to: "/system-health",
    labelKey: "system.title",
    descKey: "system.hub.health",
    roles: PLATFORM,
  },
  {
    id: "features",
    to: "/features",
    labelKey: "nav.features",
    descKey: "system.hub.features",
    roles: PLATFORM,
  },
  {
    id: "secrets",
    to: "/secrets",
    labelKey: "nav.secrets",
    descKey: "system.hub.secrets",
    roles: PLATFORM,
  },
  {
    id: "sources",
    to: "/sources",
    labelKey: "nav.sources",
    descKey: "system.hub.sources",
    // API `/admin/sources` ép công ty của tenant_admin (readTenant/writeTenant; local_path chỉ platform; ẩn đường dẫn) — test cách ly P-b/pfs1/sources-authz.
    roles: BOTH,
  },
  {
    id: "dlcSteps",
    to: "/dlc-steps",
    labelKey: "nav.dlcSteps",
    descKey: "system.hub.dlcSteps",
    roles: PLATFORM,
  },
  {
    id: "transfer",
    to: "/transfer",
    labelKey: "nav.transfer",
    descKey: "system.hub.transfer",
    roles: PLATFORM,
  },
];

/** Mục hiển thị cho vai; `frozenOn` = cờ module đóng băng (Nguồn, Import/Export ẩn khi tắt). */
export function systemEntriesFor(role: Role | undefined, frozenOn: boolean): SystemEntry[] {
  if (!role) return [];
  return SYSTEM_ENTRIES.filter((e) => e.roles.includes(role) && (frozenOn || !isFrozenPath(e.to)));
}
