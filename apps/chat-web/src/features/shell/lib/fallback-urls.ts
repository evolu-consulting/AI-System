// app-catalog · URL nhúng lúc build chỉ còn là DỰ PHÒNG khi `GET /me/apps` lỗi (danh sách thật do Admin quản lý, `@ai/web-kit/app-catalog/apps`).
const trim = (u: string | undefined): string => (u ?? "").trim().replace(/\/+$/, "");

export const FALLBACK_URLS: Readonly<Record<string, string>> = {
  contracts: trim(import.meta.env.PUBLIC_CONTRACTS_WEB_URL),
  admin: trim(import.meta.env.PUBLIC_ADMIN_WEB_URL),
};
