// B7 (UAT CR-095) · CR-052: sau đăng nhập áp `user.locale`, TRỪ khi người dùng vừa tự chọn VI/EN ở màn đăng nhập (giữ lựa chọn đó).
import type { Locale } from "@ai/i18n/locales";

let chosenOnLogin = false;

/** Gọi khi người dùng bấm công tắc VI/EN ở màn đăng nhập. */
export function markLocaleChosen(): void {
  chosenOnLogin = true;
}

/** Ngôn ngữ cần đổi sang sau đăng nhập; `null` = giữ nguyên ngôn ngữ đang chọn. Dùng một lần. */
export function localeAfterLogin(userLocale: Locale): Locale | null {
  const keep = chosenOnLogin;
  chosenOnLogin = false;
  return keep ? null : userLocale;
}
