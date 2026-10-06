// HUB-FR-72 · biến môi trường build-time của studio-web (plan-frontend D2, D4).

/** Basepath router (D2) — dùng khi cần href công khai (redirect/navigate theo `href`). */
export const BASEPATH = "/studio";

/** Gốc `/auth` (D4): vắng = tương đối cùng origin (dev proxy / reverse proxy prod). Bỏ `/` cuối. */
export const AUTH_BASE = (import.meta.env.PUBLIC_AUTH_URL ?? "").replace(/\/+$/, "");

/** Admin cùng origin (reverse proxy) hoặc URL tuyệt đối qua `PUBLIC_ADMIN_URL`. */
export const ADMIN_URL = import.meta.env.PUBLIC_ADMIN_URL || "/";

/** URL Chat App cho nút "Về Chat" (trang không quyền); vắng = ẩn nút. */
export const CHAT_URL = import.meta.env.PUBLIC_CHAT_WEB_URL || "";

/** Đường dẫn nội bộ (sau basepath) → href công khai. */
export const withBase = (path: string): string => `${BASEPATH}${path === "/" ? "" : path}`;
