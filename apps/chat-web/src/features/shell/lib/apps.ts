// sso-switch · app switcher của AI System: app đích + URL (nhúng lúc build) + luật hiện theo vai/gói. Thuần (test được).
import type { Me } from "@ai/contracts/chat";

type Role = Me["role"];

export type SwitchApp = "contracts" | "admin";
export const SWITCH_APPS: readonly SwitchApp[] = ["contracts", "admin"];

const trim = (u: string | undefined): string => (u ?? "").trim().replace(/\/+$/, "");

/** `PUBLIC_CONTRACTS_WEB_URL` / `PUBLIC_ADMIN_WEB_URL`; vắng ⇒ "" ⇒ không hiện mục đó. */
export const APP_URLS: Readonly<Record<SwitchApp, string>> = {
  contracts: trim(import.meta.env.PUBLIC_CONTRACTS_WEB_URL),
  admin: trim(import.meta.env.PUBLIC_ADMIN_WEB_URL),
};

export const isSwitchApp = (v: unknown): v is SwitchApp =>
  typeof v === "string" && (SWITCH_APPS as readonly string[]).includes(v);

/** Admin: chỉ quản trị viên (tenant/platform). Sổ Hợp Tác: gói `contracts` đã bật và người dùng có quyền (`/pack/contracts/me`). */
export function visibleApps(o: {
  urls: Readonly<Record<SwitchApp, string>>;
  role: Role | undefined;
  contractsEnabled: boolean;
}): SwitchApp[] {
  return SWITCH_APPS.filter((a) => {
    if (!o.urls[a]) return false;
    if (a === "admin") return o.role === "tenant_admin" || o.role === "platform_admin";
    return o.contractsEnabled;
  });
}
