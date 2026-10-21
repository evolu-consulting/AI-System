// V2-GAPS · app switcher ngược về AI System (chat-web) và Quản trị (admin-web), khớp "Ứng dụng" của chat-web. URL nhúng LÚC BUILD
// (`PUBLIC_CHAT_WEB_URL` hoặc `PUBLIC_SSO_URL` = AI System; `PUBLIC_ADMIN_WEB_URL`); vắng ⇒ "" ⇒ ẩn mục. Thuần (test được).

export type SwitchApp = "chat" | "admin";
export const SWITCH_APPS: readonly SwitchApp[] = ["chat", "admin"];

const trim = (u: string | undefined): string => (u ?? "").trim().replace(/\/+$/, "");

export const APP_URLS: Readonly<Record<SwitchApp, string>> = {
  chat: trim(import.meta.env.PUBLIC_CHAT_WEB_URL) || trim(import.meta.env.PUBLIC_SSO_URL),
  admin: trim(import.meta.env.PUBLIC_ADMIN_WEB_URL),
};

export const isSwitchApp = (v: unknown): v is SwitchApp =>
  typeof v === "string" && (SWITCH_APPS as readonly string[]).includes(v);

/** AI System: ai có URL. Quản trị: chỉ quản trị viên (tenant/platform) — như chat-web. */
export function visibleApps(o: {
  urls: Readonly<Record<SwitchApp, string>>;
  role: string | undefined;
}): SwitchApp[] {
  return SWITCH_APPS.filter((a) => {
    if (!o.urls[a]) return false;
    return a === "chat" || o.role === "tenant_admin" || o.role === "platform_admin";
  });
}
