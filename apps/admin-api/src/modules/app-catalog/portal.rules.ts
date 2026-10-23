// portal-home · luật thuần: app mặc định hiệu lực khi đăng nhập. Không I/O.

/**
 * Cá nhân đặt thì theo cá nhân, không thì theo công ty; app đó phải còn trong danh sách người gọi mở được
 * (bị tắt/đổi quyền ⇒ null = vào trang chủ, không kẹt ở app không mở được). Cá nhân đặt app đã mất quyền thì rơi xuống mặc
 * định công ty (nếu mở được), không thẳng về trang chủ.
 */
export function effectiveDefaultApp(
  user: string | null,
  tenant: string | null,
  openable: readonly string[],
  chat = true,
): string | null {
  for (const k of [user, tenant]) if (k && openable.includes(k)) return k;
  // app-perm · không dùng được Chat AI ⇒ trang chủ (trên origin Chat AI) là ngõ cụt: vào app đầu tiên mở được (vd Sổ Hợp Tác).
  if (!chat) return openable.find((k) => k !== "chat") ?? null;
  return null;
}

/** Chỉ tenant_admin/platform_admin đặt mặc định công ty. */
export const canSetTenantDefault = (role: string): boolean =>
  role === "tenant_admin" || role === "platform_admin";
