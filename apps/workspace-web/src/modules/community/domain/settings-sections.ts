// COM-FR-38..42 · mô hình nav hộp thoại Cài đặt: 3 nhóm theo quyền. Thuần, không I/O.
// Cá nhân: ai cũng có. Công ty: chỉ chủ quản (thành viên không phải Admin thấy trạng thái "chưa có quyền").
// Sổ Hợp Tác: CHỈ khi `caps.contracts` + có `contractsUrl` (I1/I3) ⇒ không có trong mô hình ⇒ không có trong DOM.
import { hasContractsGroup } from "./nav";

export type SettingsGroupId = "personal" | "company" | "sht";
export type SettingsSectionId =
  | "notify"
  | "lang"
  | "brand"
  | "co"
  | "rep"
  | "biz"
  | "scout"
  | "flow";
export type SettingsSection = {
  id: SettingsSectionId;
  /** `sec=` của contracts-web; chỉ mục nhóm SHT mới có. */
  sec?: SettingsSectionId;
  readonly?: boolean;
};
export type SettingsGroup = {
  id: SettingsGroupId;
  companyWide: boolean;
  sections: SettingsSection[];
};

export type SettingsInput = {
  role: "host_admin" | "host_member" | "partner" | (string & {});
  caps: { contracts: boolean };
  contractsUrl: string | null;
};

/** Thứ tự mục Sổ Hợp Tác (khớp `/settings?sec=` của contracts-web). Quy trình duyệt chỉ xem. */
export const SHT_SECTIONS: SettingsSection[] = [
  { id: "co", sec: "co" },
  { id: "rep", sec: "rep" },
  { id: "biz", sec: "biz" },
  { id: "scout", sec: "scout" },
  { id: "flow", sec: "flow", readonly: true },
];

export const isHostRole = (role: string): boolean => role !== "partner";

export function buildSettingsNav(v: SettingsInput): SettingsGroup[] {
  const groups: SettingsGroup[] = [
    {
      id: "personal",
      companyWide: false,
      sections: [{ id: "notify" }, { id: "lang" }],
    },
  ];
  if (isHostRole(v.role))
    groups.push({ id: "company", companyWide: true, sections: [{ id: "brand" }] });
  if (hasContractsGroup(v)) groups.push({ id: "sht", companyWide: true, sections: SHT_SECTIONS });
  return groups;
}

/** Chỉ Admin chủ quản được xem/đổi mục Công ty. */
export const canEditCompany = (role: string): boolean => role === "host_admin";

/** Đường dẫn contracts-web của một mục SHT. */
export const shtPath = (sec: SettingsSectionId): string => `/settings?sec=${sec}`;

export const findSection = (
  groups: SettingsGroup[],
  id: SettingsSectionId,
): SettingsSection | null => groups.flatMap((g) => g.sections).find((s) => s.id === id) ?? null;
