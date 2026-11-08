// CR-111 · metadata hiển thị của feature (app, mức, tính năng thêm). Tên/mô tả nằm ở i18n `featmeta.f.<key>.*`.
// CR-121 c18 · ỨNG DỤNG của feature đọc từ CỘT `admin.features.app` (API trả `app`) — không suy từ tiền tố khoá. Chỉ MỨC (Xem/Sửa/Quản trị) và
// "tính năng thêm" còn suy từ hậu tố khoá (registry bên dưới trước, rồi hậu tố) — đó là mức, không phải ứng dụng.

import { CONTRACTS_PARTNER_CONFIRM_FEATURE, FEATURE_APP_IDS } from "@ai/contracts/light";
import {
  BookOpen,
  FileSignature,
  Layers,
  type LucideIcon,
  MessageSquare,
  Package,
  Users,
} from "lucide-react";

export const APP_IDS = FEATURE_APP_IDS;
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

/** Feature như API trả: `app` là cột DB (nguồn duy nhất). */
export type AppFeature = { key: string; app: AppId };
export type FeatureMeta = { app: AppId; level?: Level; addon?: boolean };

/** Mức / tính năng thêm đã biết theo khoá (ưu tiên hơn hậu tố). Không chứa app. */
const KNOWN: Readonly<Record<string, { level?: Level; addon?: boolean }>> = {
  "han-muc-duyet": { addon: true },
};

/** Khoá có tên/mô tả nghiệp vụ ở i18n `featmeta.f.<key>.*` (khoá lạ hiện tên/key gốc). */
const REGISTERED: ReadonlySet<string> = new Set([
  "core",
  "chat-app",
  "community-read",
  "community-write",
  "community-admin",
  "contracts-read",
  "contracts-write",
  "contracts-admin",
  "han-muc-duyet",
  CONTRACTS_PARTNER_CONFIRM_FEATURE,
  "knowledge-read",
  "knowledge-write",
  "knowledge-admin",
]);
export const isRegistered = (key: string): boolean => REGISTERED.has(key);

/** Meta: app = cột; mức = hậu tố khoá (read/write/admin) hoặc registry; app có mức mà không có hậu tố ⇒ tính năng thêm. */
export function metaOf(f: AppFeature): FeatureMeta {
  const { key, app } = f;
  const hit = KNOWN[key];
  if (hit) return { app, ...hit };
  if (app === "core" || app === "other" || app === "chat") return { app };
  const level = LEVELS.find((l) => key.endsWith(`-${l}`));
  return level ? { app, level } : { app, addon: true };
}

export type AppGroup<T> = { app: AppId; items: T[] };

const rank = (m: FeatureMeta): number =>
  m.level ? LEVELS.indexOf(m.level) + 1 : m.addon ? LEVELS.length + 1 : 0;

/** Nhóm theo app (đúng thứ tự `APP_IDS`, bỏ nhóm rỗng); trong nhóm: cơ bản → Xem → Sửa → Quản trị → tính năng thêm → key. */
export function groupByApp<T extends AppFeature>(items: readonly T[]): AppGroup<T>[] {
  const buckets = new Map<AppId, T[]>();
  for (const it of items) buckets.set(it.app, [...(buckets.get(it.app) ?? []), it]);
  return APP_IDS.flatMap((app) => {
    const list = buckets.get(app);
    if (!list) return [];
    const sorted = [...list].sort(
      (a, b) => rank(metaOf(a)) - rank(metaOf(b)) || a.key.localeCompare(b.key),
    );
    return [{ app, items: sorted }];
  });
}
