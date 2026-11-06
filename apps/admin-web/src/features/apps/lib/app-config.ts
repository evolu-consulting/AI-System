// CR-118 · cr118-app-config · luật thuần của trang cấu hình app `/apps/$appKey`: tab, ánh xạ app catalog ↔ nhóm feature,
// khe quy trình của app, và bảng "công ty đang dùng app" (mức + tính năng thêm + số người) dựng từ entitlement.
import {
  APP_IDS,
  type AppId,
  LEVELS,
  type Level,
  metaOf,
} from "@/features/features/lib/feature-meta";

export const APP_TABS = ["overview", "features", "processes", "companies", "preview"] as const;
export type AppTab = (typeof APP_TABS)[number];
export const DEFAULT_APP_TAB: AppTab = "overview";

/** `?tab=` không hợp lệ ⇒ undefined (trang rơi về Tổng quan). */
export const parseAppTab = (v: unknown): AppTab | undefined => APP_TABS.find((t) => t === v);

export type CompaniesSearch = { tenant?: string };

/** Key app trong catalog (`contracts`, `community`, `chat`) ↔ nhóm feature trùng tên; `studio`/`admin`… không có nhóm ⇒ null. */
export function featureAppOf(appKey: string): AppId | null {
  return APP_IDS.find((a) => a === appKey && a !== "core" && a !== "other") ?? null;
}

/** Khe quy trình của app: khoá khe có tiền tố `<appKey>.` (vd `contracts.approval`). */
export const slotsOfApp = <T extends { slot?: string | null }>(
  rows: readonly T[],
  appKey: string,
): T[] => rows.filter((r) => (r.slot ?? "").startsWith(`${appKey}.`));

export type CompanyLevel = "off" | Level;
export type CompanyRow = {
  id: string;
  key: string;
  name: string;
  locked: boolean;
  level: CompanyLevel;
  /** Số tính năng thêm đang bật. */
  addons: number;
  /** Key tính năng thêm đang bật (rỗng khi app Tắt). */
  addonKeys: string[];
  /** Số người dùng đang hoạt động của công ty (theo entitlement). */
  users: number;
};

export type EntRow = { tenant_id: string; active_user_count: number };
export type TenantOption = { id: string; key: string; name: string; locked: boolean };

/**
 * Dựng bảng công ty từ danh sách công ty + entitlement theo từng feature key của app.
 * `ents` chỉ chứa feature của chính `appId` (đã lọc theo cột `app` ở hook). Mức = mức cao nhất công ty có (khớp `detectLevel` của thẻ app); app Tắt ⇒ `off`.
 */
export function buildCompanyRows(
  tenants: readonly TenantOption[],
  ents: Readonly<Record<string, readonly EntRow[]>>,
  appId: AppId,
): CompanyRow[] {
  const sets = new Map<string, Map<string, number>>();
  for (const [key, rows] of Object.entries(ents)) {
    sets.set(key, new Map(rows.map((r) => [r.tenant_id, r.active_user_count])));
  }
  const levelKey = (l: Level) =>
    Object.keys(ents).find((k) => {
      return metaOf({ key: k, app: appId }).level === l;
    });
  const addonKeys = Object.keys(ents).filter((k) => {
    return !metaOf({ key: k, app: appId }).level;
  });
  return tenants.map((t) => {
    const top = [...LEVELS].reverse().find((l) => {
      const k = levelKey(l);
      return k ? sets.get(k)?.has(t.id) : false;
    });
    const level: CompanyLevel = top ?? "off";
    const users = Math.max(0, ...[...sets.values()].map((m) => m.get(t.id) ?? 0));
    const on = level === "off" ? [] : addonKeys.filter((k) => sets.get(k)?.has(t.id));
    return { ...t, level, addons: on.length, addonKeys: on, users };
  });
}

/** Đếm công ty theo mức (cho Tổng quan: "Tắt 2 · Xem 1 · Sửa 3 · Quản trị 3"). */
export function countByLevel(
  rows: readonly { level: CompanyLevel }[],
): Record<CompanyLevel, number> {
  const out: Record<CompanyLevel, number> = { off: 0, read: 0, write: 0, admin: 0 };
  for (const r of rows) out[r.level]++;
  return out;
}

export type CompanyFilter = { level?: CompanyLevel; q?: string };

export function filterCompanies(rows: readonly CompanyRow[], f: CompanyFilter): CompanyRow[] {
  const q = (f.q ?? "").trim().toLocaleLowerCase("vi");
  return rows.filter(
    (r) =>
      (f.level === undefined || r.level === f.level) &&
      (q === "" || r.name.toLocaleLowerCase("vi").includes(q) || r.key.toLowerCase().includes(q)),
  );
}

/** Đang sửa dở một công ty (có thay đổi chưa lưu) thì chưa được chuyển sang công ty khác — tránh mất bản nháp. */
export const canSwitchCompany = (
  dirty: boolean,
  current: string | undefined,
  next: string,
): boolean => !dirty || current === next;

export type PreviewVersion = "saved" | "draft";
/** Bản nháp chỉ chọn được khi có thay đổi chưa lưu của đúng công ty đang xem; ngược lại về bản đang lưu. */
export const effectiveVersion = (wanted: PreviewVersion, hasDraft: boolean): PreviewVersion =>
  wanted === "draft" && hasDraft ? "draft" : "saved";

/** Số công ty đang bật app (mức khác Tắt) / tổng — cho dòng "Đang bật cho 7/9 công ty". */
export const enabledCount = (rows: readonly { level: CompanyLevel }[]): number =>
  rows.filter((r) => r.level !== "off").length;

export type AppWarning =
  | { code: "no_url"; count: number }
  | { code: "app_disabled"; count: number }
  | { code: "flow_needs_addon"; companies: string[]; addon: string };

/**
 * Cảnh báo cấu hình hiện ở Tổng quan thay vì để lỗi lúc chạy: app chưa có địa chỉ hoặc đang ẩn khỏi danh mục nhưng đã có công ty bật;
 * công ty được gán quy trình riêng cho một khe nhưng chưa bật tính năng thêm làm khe đó chạy (quy trình gán sẽ không được dùng).
 */
export function configWarnings(input: {
  app: { url: string; enabled: boolean };
  rows: readonly CompanyRow[];
  assigned: Readonly<Record<string, readonly { slot: string }[]>>;
  slots: readonly { key: string; addon?: string }[];
}): AppWarning[] {
  const out: AppWarning[] = [];
  const on = enabledCount(input.rows);
  if (on > 0 && input.app.url === "") out.push({ code: "no_url", count: on });
  if (on > 0 && !input.app.enabled) out.push({ code: "app_disabled", count: on });
  for (const s of input.slots) {
    if (!s.addon) continue;
    const addon = s.addon;
    const companies = input.rows
      .filter(
        (r) =>
          r.level !== "off" &&
          (input.assigned[r.id] ?? []).some((a) => a.slot === s.key) &&
          !r.addonKeys.includes(addon),
      )
      .map((r) => r.name);
    if (companies.length > 0) out.push({ code: "flow_needs_addon", companies, addon });
  }
  return out;
}
