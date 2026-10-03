// CHAT-AC-04, CHAT-AC-36 · dữ liệu + hành động cho SettingsDialog: ngôn ngữ (i18n, lưu `ai.locale`), tài khoản, đăng xuất.
// Đăng xuất xong: `session` phát `cleared` → cache query bị xoá (query-client) và `useSessionRedirect` đưa về `/login`.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { logout } from "~/features/auth/api";
import { useSession } from "~/lib/auth/use-session";
import { getTheme, setTheme, type ThemeMode, watchTheme } from "~/lib/theme";
import type { UiLanguage } from "../components/SettingsDialog";

export function useSettings() {
  const { i18n } = useTranslation();
  const me = useSession((s) => s.me);
  const [loggingOut, setLoggingOut] = useState(false);
  const [theme, setThemeState] = useState<ThemeMode>(getTheme);
  useEffect(() => watchTheme(setThemeState), []);
  const language: UiLanguage = i18n.resolvedLanguage === "en" ? "en" : "vi";

  const onLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  };

  return {
    language,
    onLanguageChange: (lang: UiLanguage) => void i18n.changeLanguage(lang),
    theme,
    onThemeChange: (mode: ThemeMode) => {
      setTheme(mode);
      setThemeState(mode);
    },
    displayName: me?.display_name ?? "",
    username: me?.username ?? "",
    tenantName: me?.tenant.name ?? "",
    loggingOut,
    onLogout: () => void onLogout(),
  };
}
