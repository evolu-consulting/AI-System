// app-catalog · luật thuần phía web của switcher "Ứng dụng": nguồn là `GET /me/apps` (admin-api đã lọc theo quyền).
// Env build chỉ là DỰ PHÒNG khi API lỗi (`fallbackApps`) — danh sách thật do Admin quản lý, thêm app không cần build lại.
import type { MeApp } from "@ai/contracts";

export type { MeApp };

/** Tên theo locale (`vi` mặc định; `en` vắng ⇒ `vi`). */
export function appLabel(app: MeApp, locale: string | undefined): string {
  return locale?.startsWith("en") && app.name.en ? app.name.en : app.name.vi;
}

/** portal-home · khoá ảo của mục "Trang chủ AI System" trong switcher (không có trong catalog). */
export const HOME_KEY = "portal";
/** `?home=1` ở `/` của chat-web: vào trang chủ dù đã đặt app mặc định. */
export const HOME_NEXT = "/?home=1";

/** Chat AI nằm dưới `/chat` (gốc `/` của cùng origin là trang chủ); app khác mở ở gốc. `url` rỗng (app hiện tại) ⇒ đường dẫn tương đối. */
export function entryUrl(app: MeApp): string {
  return app.key === "chat" ? `${app.url}/chat` : app.url;
}
/** `next` khi chuyển phiên sang app: Chat AI → `/chat`, còn lại `/`. */
export function entryNext(app: MeApp): string {
  return app.key === "chat" ? "/chat" : "/";
}

/** App mở được và không phải app hiện tại, giữ thứ tự server. */
export function otherApps(apps: readonly MeApp[], current: string | undefined): MeApp[] {
  return apps.filter((a) => a.key !== current && a.url !== "");
}

/**
 * Danh sách switcher: MỌI app người dùng mở được, gồm cả app đang chạy (đánh dấu "hiện tại", không bấm được). Server không
 * trả app khi nó chưa có URL trong catalog ⇒ thêm bản dựng sẵn (url rỗng) theo thứ tự mặc định để luôn thấy mình đang ở đâu.
 */
export function withCurrent(apps: readonly MeApp[], current: string): MeApp[] {
  if (apps.some((a) => a.key === current)) return [...apps];
  const def = FALLBACK.find((d) => d.key === current);
  if (!def) return [...apps];
  const me: MeApp = { key: def.key, name: def.name, icon: def.icon, url: "", sso: def.sso };
  const rank = (k: string) => FALLBACK.findIndex((d) => d.key === k);
  const at = apps.findIndex((a) => rank(a.key) > rank(current));
  return at < 0 ? [...apps, me] : [...apps.slice(0, at), me, ...apps.slice(at)];
}

/** Mô tả ngắn dưới tên app trong switcher (app tuỳ chỉnh do Admin thêm: không có mô tả). */
const DESCRIPTIONS: Record<string, { vi: string; en: string }> = {
  portal: { vi: "Tất cả ứng dụng của bạn", en: "All your apps" },
  chat: { vi: "Hỏi AI, trò chuyện, tệp", en: "Ask AI, chat, files" },
  contracts: { vi: "Hợp đồng, đối tác, thanh toán", en: "Contracts, partners, payments" },
  studio: { vi: "Thiết kế agent và quy trình", en: "Design agents and workflows" },
  admin: { vi: "Người dùng, phân quyền, quota", en: "Users, permissions, quota" },
};

export function appDescription(app: MeApp, locale: string | undefined): string {
  const d = DESCRIPTIONS[app.key];
  return d ? (locale?.startsWith("en") ? d.en : d.vi) : "";
}

type FallbackDef = {
  key: string;
  name: { vi: string; en: string };
  icon: string;
  sso: boolean;
  audience: "all" | "admin" | "platform";
};

// Dự phòng duy nhất (một chỗ cho cả 4 web): chỉ dùng khi `/me/apps` lỗi; quyền theo vai, KHÔNG biết gói (Sổ Hợp Tác ẩn
// trừ khi env có URL — hành vi cũ khi chat-web không hỏi được `/pack/contracts/me`).
const FALLBACK: readonly FallbackDef[] = [
  {
    key: "chat",
    name: { vi: "Chat AI", en: "AI Chat" },
    icon: "sparkles",
    sso: true,
    audience: "all",
  },
  {
    key: "contracts",
    name: { vi: "Sổ Hợp Tác", en: "Cooperation Ledger" },
    icon: "file-text",
    sso: true,
    audience: "all",
  },
  {
    key: "studio",
    name: { vi: "Studio", en: "Studio" },
    icon: "wand",
    sso: false,
    audience: "platform",
  },
  {
    key: "admin",
    name: { vi: "Quản trị", en: "Admin" },
    icon: "settings",
    sso: true,
    audience: "admin",
  },
];

/** Dự phòng từ URL nhúng lúc build (`urls[key]`); vắng/rỗng ⇒ bỏ app. Lọc theo vai như catalog. */
export function fallbackApps(
  urls: Readonly<Record<string, string | undefined>>,
  role: string | undefined,
): MeApp[] {
  const isAdmin = role === "tenant_admin" || role === "platform_admin";
  return FALLBACK.filter((d) => {
    const url = (urls[d.key] ?? "").trim();
    if (!url) return false;
    if (d.audience === "admin") return isAdmin;
    if (d.audience === "platform") return role === "platform_admin";
    return true;
  }).map((d) => ({
    key: d.key,
    name: d.name,
    icon: d.icon,
    url: (urls[d.key] ?? "").trim().replace(/\/+$/, ""),
    sso: d.sso,
  }));
}
