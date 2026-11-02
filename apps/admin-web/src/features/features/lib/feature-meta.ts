// CR-111 · registry metadata hiển thị của feature (app, mức, tính năng thêm). Tên/mô tả nằm ở i18n `featmeta.f.<key>.*`.
// Key lạ: suy app từ tiền tố (vd `contracts-xyz` → app Sổ Hợp Tác, tính năng thêm); không khớp → "Khác" (hiện tên/key gốc).
import {
  BookOpen,
  FileSignature,
  Layers,
  type LucideIcon,
  MessageSquare,
  Package,
  Users,
} from "lucide-react";

export const APP_IDS = ["core", "chat", "community", "contracts", "knowledge", "other"] as const;
export type AppId = (typeof APP_IDS)[number];
export const LEVELS = ["read", "write", "admin"] as const;
export type Level = (typeof LEVELS)[number];

type AppInfo = { icon: LucideIcon; levels: boolean };
/** Thứ tự khai báo = thứ tự nhóm trên màn hình. */
export const APPS: Record<AppId, AppInfo> = {
  core: { icon: Layers, levels: false },
  chat: { icon: MessageSquare, levels: false },
  community: { icon: Users, levels: true },
  contracts: { icon: FileSignature, levels: true },
  knowledge: { icon: BookOpen, levels: true },
  other: { icon: Package, levels: false },
};

export type FeatureMeta = { app: AppId; level?: Level; addon?: boolean };

const lv = (app: AppId, level: Level): FeatureMeta => ({ app, level });
const addon = (app: AppId): FeatureMeta => ({ app, addon: true });

export const FEATURE_META: Readonly<Record<string, FeatureMeta>> = {
  core: { app: "core" },
  "chat-app": { app: "chat" },
  "community-read": lv("community", "read"),
  "community-write": lv("community", "write"),
  "community-admin": lv("community", "admin"),
  "contracts-read": lv("contracts", "read"),
  "contracts-write": lv("contracts", "write"),
  "contracts-admin": lv("contracts", "admin"),
  "contracts-approval-engine": addon("contracts"),
  "han-muc-duyet": addon("contracts"),
  "knowledge-read": lv("knowledge", "read"),
  "knowledge-write": lv("knowledge", "write"),
  "knowledge-admin": lv("knowledge", "admin"),
};

export const isRegistered = (key: string): boolean => key in FEATURE_META;

/** Meta của key: registry → suy theo tiền tố app đã biết → "Khác". */
export function metaOf(key: string): FeatureMeta {
  const hit = FEATURE_META[key];
  if (hit) return hit;
  const [prefix, ...rest] = key.split("-");
  const app = APP_IDS.find((a) => a === prefix && a !== "core" && a !== "other");
  if (!app) return { app: "other" };
  const suffix = rest.join("-");
  const level = LEVELS.find((l) => l === suffix);
  return level ? { app, level } : { app, addon: true };
}

export type AppGroup<T> = { app: AppId; items: T[] };

const rank = (m: FeatureMeta): number =>
  m.level ? LEVELS.indexOf(m.level) + 1 : m.addon ? LEVELS.length + 1 : 0;

/** Nhóm theo app (đúng thứ tự `APP_IDS`, bỏ nhóm rỗng); trong nhóm: cơ bản → Xem → Sửa → Quản trị → tính năng thêm → key. */
export function groupByApp<T extends { key: string }>(items: readonly T[]): AppGroup<T>[] {
  const buckets = new Map<AppId, T[]>();
  for (const it of items) {
    const app = metaOf(it.key).app;
    buckets.set(app, [...(buckets.get(app) ?? []), it]);
  }
  return APP_IDS.flatMap((app) => {
    const list = buckets.get(app);
    if (!list) return [];
    const sorted = [...list].sort(
      (a, b) => rank(metaOf(a.key)) - rank(metaOf(b.key)) || a.key.localeCompare(b.key),
    );
    return [{ app, items: sorted }];
  });
}
