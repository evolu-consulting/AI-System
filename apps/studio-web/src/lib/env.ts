// HUB-FR-72 · biến môi trường build-time của studio-web (plan-frontend D2, D4).

/** Basepath router (D2) — dùng khi cần href công khai (redirect/navigate theo `href`). */
export const BASEPATH = "/studio";

/** Gốc `/auth` (D4): vắng = tương đối cùng origin (dev proxy / reverse proxy prod). Bỏ `/` cuối. */
export const AUTH_BASE = (import.meta.env.PUBLIC_AUTH_URL ?? "").replace(/\/+$/, "");

/** URL admin-web (`PUBLIC_ADMIN_WEB_URL`, spec §7 · Q9; dev `http://localhost:3000`), bỏ `/` cuối; vắng = "" ⇒ ẩn link Admin. */
export const ADMIN_URL = (import.meta.env.PUBLIC_ADMIN_WEB_URL ?? "").replace(/\/+$/, "");

/** URL Chat App cho nút "Về Chat" (trang không quyền); vắng = ẩn nút. */
export const CHAT_URL = import.meta.env.PUBLIC_CHAT_WEB_URL || "";

/** Đường dẫn nội bộ (sau basepath) → href công khai. */
export const withBase = (path: string): string => `${BASEPATH}${path === "/" ? "" : path}`;
