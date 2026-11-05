// CR-120 · menu trái của MỘT AppShell sinh từ manifest các module (thuần, test được): mỗi module bật (gói yêu cầu) đóng góp một nhóm.
// Đối tác (không có gói contracts) chỉ còn nhóm Community; module tắt ⇒ không có nhóm/không có mục nào trong DOM.
import type { AccountEntry, ModuleManifest, NavEntry } from "~/shared/kernel/module-manifest";

export type ShellNavGroup = {
  key: string;
  labelKey: string;
  basePath: string;
  items: readonly NavEntry[];
};

/** Module nào mở được: `can(pack)` (cờ FeatureGate `<pack>`). */
export type CanPack = (pack: string) => boolean;

const byOrder = (a: ModuleManifest, b: ModuleManifest): number => a.order - b.order;

export function buildShellNav(
  manifests: readonly ModuleManifest[],
  can: CanPack,
): readonly ShellNavGroup[] {
  return [...manifests]
    .sort(byOrder)
    .filter((m) => can(m.requires.pack) && m.nav.length > 0)
    .map((m) => ({
      key: m.key,
      labelKey: m.groupLabelKey,
      basePath: m.basePath,
      items: m.nav,
    }));
}

/** Mục menu tài khoản do các module bật đóng góp (theo thứ tự nhóm). */
export function buildAccountEntries(
  manifests: readonly ModuleManifest[],
  can: CanPack,
): readonly AccountEntry[] {
  return [...manifests]
    .sort(byOrder)
    .filter((m) => can(m.requires.pack))
    .flatMap((m) => m.accountMenu ?? []);
}

const under = (pathname: string, prefix: string): boolean =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

/** Mục đang chọn của một nhóm theo đường dẫn (`/contracts/c/1` → mục có `also` chứa `/contracts/c`). */
export function activeEntry(group: ShellNavGroup, pathname: string): NavEntry | undefined {
  return group.items.find((n) =>
    n.exact
      ? pathname === n.to
      : under(pathname, n.to) || (n.also ?? []).some((a) => under(pathname, a)),
  );
}

/** Khoá module sở hữu đường dẫn (theo `basePath`), không thuộc module nào ⇒ undefined. */
export function moduleOfPath(
  manifests: readonly ModuleManifest[],
  pathname: string,
): ModuleManifest | undefined {
  return manifests.find((m) => under(pathname, m.basePath));
}
