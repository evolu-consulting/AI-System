// CR-125 c3 · một nguồn cho đường dẫn "Cài đặt › <mục>" trong câu hướng dẫn. Nhãn lấy từ `contracts.settings.sec.*` (v2l);
// chuỗi chỉ ghi token `{{path:<khoá mục>}}` (vd `{{path:flow}}`), loader mở rộng lúc nạp ⇒ đổi tên mục chỉ sửa một chỗ.

import enSettings from "../locales/contracts/v2l.en.json";
import viSettings from "../locales/contracts/v2l.vi.json";
import type { Locale } from "./locales";

type SettingsTree = { contracts: { settings: { title: string; sec: Record<string, string> } } };
const TREES: Record<Locale, SettingsTree> = { vi: viSettings, en: enSettings };
export const PATH_SEPARATOR = " › ";
const TOKEN = /\{\{path:(\w+)\}\}/g;

/** Mục Cài đặt có nhãn thật (khoá `sec.<k>` không có hậu tố Hint). */
export function settingsSectionKeys(): string[] {
  return Object.keys(TREES.vi.contracts.settings.sec).filter((k) => !k.endsWith("Hint"));
}

/** "Cài đặt › Quy trình duyệt" (theo ngôn ngữ). Khoá lạ ⇒ throw (token sai phải lộ ngay ở test/check). */
export function settingsPath(locale: Locale, key: string): string {
  const s = TREES[locale].contracts.settings;
  const label = s.sec[key];
  if (label === undefined || key.endsWith("Hint"))
    throw new Error(`settings-paths: mục "${key}" không tồn tại`);
  return `${s.title}${PATH_SEPARATOR}${label}`;
}

/** Thay `{{path:<mục>}}` trong mọi chuỗi của cây locale. */
export function expandPathTokens<T>(tree: T, locale: Locale): T {
  if (typeof tree === "string")
    return tree.replace(TOKEN, (_m, k: string) => settingsPath(locale, k)) as T;
  if (typeof tree !== "object" || tree === null) return tree;
  if (Array.isArray(tree)) return tree.map((v) => expandPathTokens(v, locale)) as T;
  return Object.fromEntries(
    Object.entries(tree).map(([k, v]) => [k, expandPathTokens(v, locale)]),
  ) as T;
}
