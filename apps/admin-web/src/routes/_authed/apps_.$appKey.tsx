import { createFileRoute } from "@tanstack/react-router";
import { type AppTab, DEFAULT_APP_TAB, parseAppTab } from "@/features/apps/lib/app-config";
import { AppDetailPage } from "@/features/apps/pages/AppDetailPage";

// CR-118 · /apps/$appKey (chỉ platform_admin): trang cấu hình một app, 5 tab theo `?tab=` (mặc định Tổng quan).
// `apps_` (gạch dưới) để route này KHÔNG lồng trong `/apps` (danh sách) — cùng cách với `usage_.analytics`.
function Page() {
  const { appKey } = Route.useParams();
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <AppDetailPage
      appKey={appKey}
      tab={tab ?? DEFAULT_APP_TAB}
      onTab={(t) => void navigate({ search: { tab: t }, replace: true })}
    />
  );
}

export const Route = createFileRoute("/_authed/apps_/$appKey")({
  validateSearch: (s: Record<string, unknown>): { tab?: AppTab } => ({ tab: parseAppTab(s.tab) }),
  component: Page,
});
