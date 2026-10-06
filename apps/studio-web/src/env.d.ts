/// <reference types="@rsbuild/core/types" />

interface ImportMetaEnv {
  /** URL admin-web (link "⇄ Admin", Admin › Workflows, đổi mật khẩu); vắng = ẩn link. */
  readonly PUBLIC_ADMIN_WEB_URL?: string;
  /** URL Chat App (trang không quyền, F2); vắng = ẩn nút. */
  readonly PUBLIC_CHAT_WEB_URL?: string;
  /** Gốc admin-api cho `/auth/*` (D4); vắng = tương đối (proxy). Khác origin ⇒ không refresh bằng cookie (CR-044). */
  readonly PUBLIC_AUTH_URL?: string;
}
