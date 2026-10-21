// app-catalog · luật thuần phía web của switcher "Ứng dụng": nguồn là `GET /me/apps` (admin-api đã lọc theo quyền).
// Env build chỉ là DỰ PHÒNG khi API lỗi (`fallbackApps`) — danh sách thật do Admin quản lý, thêm app không cần build lại.
import type { MeApp } from "@ai/contracts";

export type { MeApp };

/** Tên theo locale (`vi` mặc định; `en` vắng ⇒ `vi`). */
export function appLabel(app: MeApp, locale: string | undefined): string {
  return locale?.startsWith("en") && app.name.en ? app.name.en : app.name.vi;
}

/** Danh sách hiển thị: bỏ app hiện tại (đang ở đó rồi), giữ thứ tự server. */
export function otherApps(apps: readonly MeApp[], current: string | undefined): MeApp[] {
  return apps.filter((a) => a.key !== current && a.url !== "");
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
    name: { vi: "AI System", en: "AI System" },
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
