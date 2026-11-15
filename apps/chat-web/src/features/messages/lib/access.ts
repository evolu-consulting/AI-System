// CR-169 · «Tin nhắn» chỉ hiện với người dùng được mở Sổ Hợp Tác (`/auth/me/apps` đã lọc quyền + gói + app tắt).
import type { MeApp } from "@ai/contracts/app-catalog";

export const MESSAGES_APP_KEY = "contracts";

export const canUseMessages = (apps: ReadonlyArray<Pick<MeApp, "key">> | undefined): boolean =>
  !!apps?.some((a) => a.key === MESSAGES_APP_KEY);
