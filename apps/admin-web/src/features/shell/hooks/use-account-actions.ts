// ADM-FR-01 · hành động của menu avatar: đăng xuất. (Đổi ngôn ngữ/giao diện: `PrefsPanel` dùng chung, prefs-sync.)
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { session } from "@/lib/auth/session";

export function useAccountActions() {
  const navigate = useNavigate();

  const signOut = useCallback(async () => {
    await session.logout();
    await navigate({ to: "/login", search: {} });
  }, [navigate]);

  return { signOut };
}
