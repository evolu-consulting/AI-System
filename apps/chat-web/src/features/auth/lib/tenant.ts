// CHAT-AC-01 · nhớ mã công ty trên thiết bị (ui-chat §7): điền sẵn lần sau, "Đổi công ty" để sửa.
import { readLocal, writeLocal } from "~/lib/storage";

export const TENANT_STORAGE_KEY = "chat:tenant_key";

/** Mã công ty gửi lên: trim + chữ thường (khớp `LoginIdSchema` của contract). */
export const normalizeLoginId = (v: string): string => v.trim().toLowerCase();

export const rememberedTenant = (): string => readLocal(TENANT_STORAGE_KEY) ?? "";

export function rememberTenant(key: string): void {
  if (key) writeLocal(TENANT_STORAGE_KEY, key);
}
