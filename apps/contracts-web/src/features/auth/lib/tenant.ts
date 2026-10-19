// PK-FR-10 · TF4 · Q-F3 (D-21): mã công ty khi đăng nhập. Biết sẵn tenant (?tenant= > env `PUBLIC_TENANT_KEY` > nhớ trên
// thiết bị) ⇒ ẩn ô "Mã công ty"; chưa biết ⇒ hiện. Đăng nhập thành công thì nhớ lại cho lần sau.

export const TENANT_STORAGE_KEY = "contracts:tenant_key";

/** Mã công ty / tên đăng nhập gửi lên: trim + chữ thường (khớp `LoginIdSchema` của contract). */
export const normalizeLoginId = (v: string): string => v.trim().toLowerCase();

export type TenantSources = { search?: unknown; env?: unknown; remembered?: string | null };

/** Mã công ty biết trước, hoặc "" khi phải hỏi người dùng. */
export function knownTenant(src: TenantSources): string {
  for (const v of [src.search, src.env, src.remembered]) {
    if (typeof v === "string" && normalizeLoginId(v) !== "") return normalizeLoginId(v);
  }
  return "";
}

export function rememberedTenant(): string | null {
  try {
    return localStorage.getItem(TENANT_STORAGE_KEY);
  } catch {
    return null; // storage bị chặn
  }
}

export function rememberTenant(key: string): void {
  if (!key) return;
  try {
    localStorage.setItem(TENANT_STORAGE_KEY, key);
  } catch {
    // storage bị chặn: lần sau hỏi lại
  }
}
