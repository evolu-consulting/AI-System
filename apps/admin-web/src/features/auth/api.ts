// ADM-FR-01, ADM-FR-03 · gọi API /auth/* (nơi duy nhất; FE3 bổ sung login/đổi mật khẩu).
import type { Locale, Me } from "@ai/contracts";
import { api } from "@/lib/http";

/** Đổi ngôn ngữ phiên (`PATCH /auth/me`), trả hồ sơ mới. */
export function patchMyLocale(locale: Locale): Promise<Me> {
  return api<Me>("/auth/me", { method: "PATCH", body: { locale } });
}
