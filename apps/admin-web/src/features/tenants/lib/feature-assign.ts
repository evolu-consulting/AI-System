// CR-111 · luật thuần của tab "Feature" (chi tiết công ty): thẻ theo app, mức Tắt/Xem/Sửa/Quản trị ↔ tập key entitlement
// (cộng dồn: Sửa = read+write, Quản trị = read+write+admin), tính năng thêm, và diff "hiện có → mong muốn" để lưu một lượt.
import {
  APPS,
  type AppId,
  groupByApp,
  LEVELS,
  type Level,
  metaOf,
} from "@/features/features/lib/feature-meta";
import type { LocalizedText } from "@/lib/localized";

export type TenantFeature = {
  id: string;
  key: string;
  name: LocalizedText;
  /** CR-121 c18 · cột `admin.features.app`. */
  app: AppId;
  entitled: boolean;
};
export type AppLevel = "off" | Level;
/** core: luôn bật · levels: thanh Tắt/Xem/Sửa/Quản trị · switch: một công tắc · list: mỗi feature một công tắc. */
export type CardMode = "core" | "levels" | "switch" | "list";
export type AppCard = {
  app: AppId;
  mode: CardMode;
  /** Feature chính của app dạng `switch` (vd `chat-app`). */
  main?: TenantFeature;
  levelFeatures: Partial<Record<Level, TenantFeature>>;
  /** Tính năng thêm (mode levels/switch) hoặc mọi feature (mode list). */
  addons: TenantFeature[];
};

/** Hàm tính cụm cho từng app từ catalog (mọi feature, kèm cờ đã cấp). */
export function buildCards(features: readonly TenantFeature[]): AppCard[] {
  return groupByApp(features).map(({ app, items }) => {
    const levelFeatures: Partial<Record<Level, TenantFeature>> = {};
    for (const f of items) {
      const level = metaOf(f).level;
      if (level && APPS[app].levels) levelFeatures[level] = f;
    }
    const base = { app, levelFeatures };
    if (app === "core") return { ...base, mode: "core" as const, addons: [] };
    if (Object.keys(levelFeatures).length > 0) {
      const addons = items.filter((f) => !Object.values(levelFeatures).includes(f));
      return { ...base, mode: "levels" as const, addons };
    }
    const main = app === "chat" ? items.find((f) => f.key === "chat-app") : undefined;
    if (main)
      return { ...base, mode: "switch" as const, main, addons: items.filter((f) => f !== main) };
    return { ...base, mode: "list" as const, addons: items };
  });
}

/** Key cấp cho mức `level` (cộng dồn), chỉ các key có trong catalog. */
export function keysForLevel(card: AppCard, level: AppLevel): string[] {
  if (level === "off") return [];
  return LEVELS.slice(0, LEVELS.indexOf(level) + 1).flatMap((l) => {
    const f = card.levelFeatures[l];
    return f ? [f.key] : [];
  });
}

/** Mức chọn được khi mọi mức thấp hơn (và chính nó) đều có feature trong catalog. */
export function availableLevels(card: AppCard): Record<AppLevel, boolean> {
  const out: Record<AppLevel, boolean> = { off: true, read: false, write: false, admin: false };
  let ok = true;
  for (const l of LEVELS) {
    ok = ok && !!card.levelFeatures[l];
    out[l] = ok;
  }
  return out;
}

const levelKeys = (card: AppCard): string[] =>
  LEVELS.flatMap((l) => card.levelFeatures[l]?.key ?? []);

/** Mức cao nhất đang có; `consistent` = tập key đúng bằng mức đó (thiếu read khi có write, hoặc app Tắt mà còn tính năng thêm ⇒ không chuẩn). */
export function detectLevel(
  card: AppCard,
  draft: ReadonlySet<string>,
): { level: AppLevel; consistent: boolean } {
  const top = [...LEVELS].reverse().find((l) => {
    const f = card.levelFeatures[l];
    return f ? draft.has(f.key) : false;
  });
  const level: AppLevel = top ?? "off";
  const want = new Set(keysForLevel(card, level));
  const have = levelKeys(card).filter((k) => draft.has(k));
  const sameLevels = have.length === want.size && have.every((k) => want.has(k));
  const orphanAddons = level === "off" && card.addons.some((f) => draft.has(f.key));
  return { level, consistent: sameLevels && !orphanAddons };
}

/** Đặt mức (chuẩn hoá luôn); `off` gỡ cả tính năng thêm của app. */
export function setLevel(draft: ReadonlySet<string>, card: AppCard, level: AppLevel): Set<string> {
  const next = new Set(draft);
  for (const k of levelKeys(card)) next.delete(k);
  if (level === "off") for (const f of card.addons) next.delete(f.key);
  for (const k of keysForLevel(card, level)) next.add(k);
  return next;
}

export function setKey(draft: ReadonlySet<string>, key: string, on: boolean): Set<string> {
  const next = new Set(draft);
  if (on) next.add(key);
  else next.delete(key);
  return next;
}

/** Key đang được cấp (bỏ `core`: luôn có hiệu lực, không có hàng entitlement). */
export function entitledKeys(features: readonly TenantFeature[]): Set<string> {
  return new Set(features.filter((f) => f.entitled && f.app !== "core").map((f) => f.key));
}

/** Việc cần làm để đưa trạng thái hiện có về `draft`: chỉ feature có trong catalog, không đụng `core`. */
export function diffEntitlements(
  features: readonly TenantFeature[],
  draft: ReadonlySet<string>,
): { grant: TenantFeature[]; revoke: TenantFeature[] } {
  const own = features.filter((f) => f.app !== "core");
  return {
    grant: own.filter((f) => !f.entitled && draft.has(f.key)),
    revoke: own.filter((f) => f.entitled && !draft.has(f.key)),
  };
}

export const activeAddons = (card: AppCard, draft: ReadonlySet<string>): number =>
  card.addons.filter((f) => draft.has(f.key)).length;
