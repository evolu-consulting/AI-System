/// <reference types="@rsbuild/core/types" />

interface ImportMetaEnv {
  /** URL Admin (nút "⇄ Admin"); vắng = `/` cùng origin. */
  readonly PUBLIC_ADMIN_URL?: string;
  /** URL Chat App (trang không quyền, F2); vắng = ẩn nút. */
  readonly PUBLIC_CHAT_WEB_URL?: string;
  /** Gốc admin-api cho `/auth/*` (D4); vắng = tương đối (proxy). Khác origin ⇒ không refresh bằng cookie (CR-044). */
  readonly PUBLIC_AUTH_URL?: string;
}
