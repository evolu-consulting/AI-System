// C1 FE · route gốc: Outlet + Toaster dùng chung (toast "Phiên đã hết hạn"…); đường lạ → `/c/new` (plan-frontend §2).
// CR-118 bundle: Toaster (sonner) tải lười — không nằm trong JS ban đầu.
import { NotFoundPage } from "@ai/web-kit/ui/EmptyState";
import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";

const Toaster = lazy(() => import("@ai/web-kit/ui/toaster").then((m) => ({ default: m.Toaster })));

function Root() {
  return (
    <>
      <Outlet />
      <Suspense fallback={null}>
        <Toaster position="bottom-right" />
      </Suspense>
    </>
  );
}

// CR-131 · đường lạ: một câu chung + nút về trang chào (không chuyển hướng âm thầm).
function NotFound() {
  const { t } = useTranslation();
  return (
    <NotFoundPage
      title={t("notFoundPage.title")}
      hint={t("notFoundPage.body")}
      homeTo="/c/new"
      homeLabel={t("thread.backHome")}
      Link={Link}
    />
  );
}

export const Route = createRootRoute({
  component: Root,
  notFoundComponent: NotFound,
});
