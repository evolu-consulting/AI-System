// PK-FR-10 · TF1 · route gốc: Outlet + Toaster dùng chung; đường lạ → `/contracts` (Tổng quan; plan-frontend §1).
// CR-118 bundle: DialogHost (radix dialog) + Toaster (sonner) tải lười — không nằm trong JS ban đầu.
import { NotFoundPage } from "@ai/web-kit/ui/EmptyState";
import { createRootRoute, Link, Outlet, redirect } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { expectHost } from "~/components/shared/dialog-bus";
import { legacyTarget } from "~/shared/kernel/legacy-routes";

// Tải ngay khi nạp route gốc; confirm/prompt gọi sớm chờ host (dialog-bus.expectHost).
const hostChunk = import("~/components/shared/dialog-host");
expectHost(hostChunk);
const DialogHost = lazy(() => hostChunk.then((m) => ({ default: m.DialogHost })));
const Toaster = lazy(() => import("@ai/web-kit/ui/toaster").then((m) => ({ default: m.Toaster })));

function Root() {
  return (
    <>
      <Outlet />
      <Suspense fallback={null}>
        <DialogHost />
      </Suspense>
      <Suspense fallback={null}>
        <Toaster position="bottom-right" />
      </Suspense>
    </>
  );
}

// CR-131 · đường lạ: một câu chung + nút về Tổng quan (không chuyển hướng âm thầm).
function NotFound() {
  const { t } = useTranslation();
  return (
    <NotFoundPage
      title={t("contracts.notFoundPage.title")}
      hint={t("contracts.notFoundPage.body")}
      homeTo="/contracts"
      homeLabel={t("contracts.notFoundPage.home")}
      Link={Link}
    />
  );
}

export const Route = createRootRoute({
  // CR-119 phần 2: URL SHT cũ ở gốc (/overview, /contracts/<id>, /partners…) → URL mới dưới /contracts (bookmark, email, thông báo cũ).
  beforeLoad: ({ location }) => {
    const to = legacyTarget(location.href);
    if (to) throw redirect({ href: to, replace: true });
  },
  component: Root,
  notFoundComponent: NotFound,
});
