// CR-112 · ADM-FR-80, ADM-FR-82 · nhãn mức/vai/app của màn Phân quyền theo vai (hàm thuần: trả key i18n, không dịch chuỗi).
import { type AppRoleLevel, levelRank } from "@ai/contracts/app-roles";

export const LEVELS: readonly AppRoleLevel[] = ["read", "write", "admin"];

export const LEVEL_KEY: Record<AppRoleLevel, string> = {
  read: "appRoles.level.read",
  write: "appRoles.level.write",
  admin: "appRoles.level.admin",
};

/** Vai mặc định (khoá cố định `viewer|editor|owner`) → nhãn "Chỉ xem / Nhân viên / Toàn quyền". */
export const DEFAULT_ROLE_KEY: Record<string, string> = {
  viewer: "appRoles.defaultRole.viewer",
  editor: "appRoles.defaultRole.editor",
  owner: "appRoles.defaultRole.owner",
};

const KNOWN_PACKS = ["contracts", "community", "knowledge"] as const;

/** App có nhãn i18n riêng; app lạ ⇒ chính khoá gói. */
export const packNameKey = (pack: string): string | null =>
  (KNOWN_PACKS as readonly string[]).includes(pack) ? `appRoles.pack.${pack}` : null;

/** Contracts, Community, Knowledge đứng trước, còn lại theo khoá. */
export function sortPacks(packs: readonly string[]): string[] {
  const rank = (p: string) => {
    const i = (KNOWN_PACKS as readonly string[]).indexOf(p);
    return i < 0 ? KNOWN_PACKS.length : i;
  };
  return [...packs].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** Vai mặc định ⇒ nhãn chuẩn; vai tuỳ biến ⇒ tên tự đặt. Trả `{key}` hoặc `{text}`. */
export function roleLabel(
  role: { isDefault: boolean; key: string; name: { vi: string; en?: string } },
  lang: string,
): { key: string } | { text: string } {
  const key = role.isDefault ? DEFAULT_ROLE_KEY[role.key] : undefined;
  if (key) return { key };
  const en = role.name.en?.trim();
  return { text: lang.startsWith("en") && en ? en : role.name.vi };
}

export const maxLevel = (a: AppRoleLevel | null, b: AppRoleLevel): AppRoleLevel =>
  a === null || levelRank(b) > levelRank(a) ? b : a;
