// CHAT-AC-04, CHAT-AC-36 · dữ liệu + hành động cho SettingsDialog: tài khoản, đăng xuất. Giao diện + ngôn ngữ: `PrefsPanel` dùng chung (prefs-sync).
// Đăng xuất xong: `session` phát `cleared` → cache query bị xoá (query-client) và `useSessionRedirect` đưa về `/login`.
import { useState } from "react";
import { logout } from "~/features/auth/api";
import { useSession } from "~/lib/auth/use-session";

export function useSettings() {
  const me = useSession((s) => s.me);
  const [loggingOut, setLoggingOut] = useState(false);

  const onLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  };

  return {
    displayName: me?.display_name ?? "",
    username: me?.username ?? "",
    tenantName: me?.tenant.name ?? "",
    loggingOut,
    onLogout: () => void onLogout(),
  };
}
