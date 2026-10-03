// ADM-FR-41 · card "Người dùng mới chưa đăng nhập": ≤ 5 user + "Reset mật khẩu" (mở drawer Users) + "Xem tất cả".
import type { OverviewResponse } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { formatAgo } from "@/lib/format";
import type { LoadError } from "@/lib/load-error";
import { useTr } from "@/lib/use-translate";
import { Panel } from "./Panel";

type Tenant = Extract<OverviewResponse, { kind: "tenant" }>;
type Props = {
  users: Tenant["never_logged_in"] | undefined;
  total: number;
  loading?: boolean;
  error?: (LoadError & { onRetry?: () => void }) | null;
};

export function NeverLoggedIn({ users, total, loading, error }: Props) {
  const { t } = useTranslation();
  const tr = useTr();
  const now = new Date();
  return (
    <Panel
      title={t("overview.neverLoggedIn.title")}
      loading={loading}
      error={error}
      footer={
        total > 0 ? (
          <Link
            to="/users"
            search={{ login: "never" }}
            className="font-medium text-primary hover:underline"
          >
            {t("overview.neverLoggedIn.all")}
          </Link>
        ) : null
      }
    >
      {users?.length ? (
        <ul className="space-y-2">
          {users.map((u) => (
            <li key={u.id} className="flex items-center justify-between gap-3 text-body">
              <span className="min-w-0 truncate">
                {u.username} · {u.display_name} ·{" "}
                <span className="text-muted-foreground">
                  {t("overview.neverLoggedIn.item", { relative: formatAgo(u.created_at, now, tr) })}
                </span>
              </span>
              <Link
                to="/users"
                search={{ drawer: "edit", user: u.id }}
                className="shrink-0 rounded-md border border-border px-3 py-1 text-label font-medium hover:bg-accent"
              >
                {t("users.menu.resetPassword")}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body text-muted-foreground">{t("overview.neverLoggedIn.empty")}</p>
      )}
    </Panel>
  );
}
