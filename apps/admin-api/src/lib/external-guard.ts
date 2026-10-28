// CR-102a · com-c2-ext-deny: user ngoài (đối tác) ở admin-api — TỪ CHỐI MẶC ĐỊNH. Luật thuần, gọi trong `requireAuth` (một chỗ
// cho mọi route cần đăng nhập ⇒ route mới thêm sau này cũng bị chặn). Đối tác chỉ: xem/sửa hồ sơ mình (`/auth/me`), đổi mật
// khẩu, đăng xuất, xin mã SSO (đích lọc tiếp ở `ssoTarget` ⇒ chỉ Community), danh sách app/portal của mình (đã lọc) và đặt app
// mặc định (chỉ app mở được). Còn lại (`/admin/*`, góp ý, 2FA, …) ⇒ 403.
const ALLOW: readonly (readonly [method: string, path: RegExp])[] = [
  ["GET", /^\/auth\/me$/],
  ["PATCH", /^\/auth\/me$/],
  ["POST", /^\/auth\/change-password$/],
  ["POST", /^\/auth\/logout$/],
  ["POST", /^\/auth\/sso\/code$/],
  ["GET", /^\/(?:auth\/)?me\/(?:apps|portal)$/],
  ["PUT", /^\/(?:auth\/)?me\/default-app$/],
];

/** Đối tác được gọi `method path` không. Nội bộ không qua hàm này. */
export function externalRouteAllowed(method: string, path: string): boolean {
  const p = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  return ALLOW.some(([m, re]) => m === method && re.test(p));
}
