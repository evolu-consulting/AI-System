// app-catalog · URL nhúng lúc build chỉ còn là DỰ PHÒNG khi `GET /auth/me/apps` lỗi (danh sách thật do Admin quản lý).
import { ADMIN_URL, CHAT_URL } from "./env";

export const FALLBACK_URLS: Readonly<Record<string, string>> = {
  chat: CHAT_URL.trim().replace(/\/+$/, ""),
  admin: ADMIN_URL,
};
