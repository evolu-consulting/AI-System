// PK-FR-05 · PK-FR-10 · TF4 · `useMe`: người dùng (tên, tenant — từ phiên) + quyền gói (`write`/`owner` suy từ `actions` của
// `GET /pack/contracts/me`). `/me` 401 sau khi web-kit đã refresh 1 lần ⇒ hết phiên: toast + đăng xuất (về `/login?next=`).
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "~/components/shared/toast";
import { logout } from "~/features/auth/api";
import { useSession } from "~/features/auth/hooks/use-session";
import { session } from "~/features/auth/lib/session";
import { fetchPackMe } from "../api";
import { errorKind, loadErrorKey, ME_QUERY_KEY, type PackView, packView } from "../lib/pack-state";

export type MeState = {
  status: "loading" | "error" | "ready";
  /** Có khi `status = ready`. */
  view: PackView | null;
  /** Key i18n câu lỗi khi `status = error`. */
  errorKey: string | null;
  retry: () => void;
  user: ReturnType<typeof session.getState>["me"];
  write: boolean;
  owner: boolean;
};

export function useMe(): MeState {
  const { t } = useTranslation();
  const user = useSession((s) => s.me);
  const q = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: ({ signal }) => fetchPackMe(signal),
    // Lỗi hiện ngay kèm "Thử lại" (không tự thử lại ngầm).
    retry: false,
  });
  const unauthorized = q.isError && errorKind(q.error) === "unauthorized";

  useEffect(() => {
    if (!unauthorized || session.getState().status !== "authed") return;
    toast(t("contracts.session.expired"), "late");
    void logout();
  }, [unauthorized, t]);

  const view = q.data ? packView(q.data) : null;
  const ok = view?.kind === "ok" ? view : null;
  return {
    status: q.data ? "ready" : q.isError && !unauthorized && !q.isFetching ? "error" : "loading",
    view,
    errorKey: q.isError ? loadErrorKey(q.error) : null,
    retry: () => void q.refetch(),
    user,
    write: ok?.write ?? false,
    owner: ok?.owner ?? false,
  };
}
