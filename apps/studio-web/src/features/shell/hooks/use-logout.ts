// HUB-FR-72 · đăng xuất: báo admin-api, xoá phiên + cache query, về /login.
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { session } from "#/lib/auth/session";

export function useLogout() {
  const router = useRouter();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const logout = useCallback(async () => {
    setBusy(true);
    await session.logout();
    qc.clear();
    await router.navigate({ to: "/login", search: {}, replace: true });
  }, [qc, router]);
  return { logout, busy };
}
