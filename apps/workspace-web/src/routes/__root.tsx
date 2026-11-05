// PK-FR-10 · TF1 · route gốc: Outlet + Toaster dùng chung; đường lạ → `/contracts` (Tổng quan; plan-frontend §1).
// CR-118 bundle: DialogHost (radix dialog) + Toaster (sonner) tải lười — không nằm trong JS ban đầu.
import { createRootRoute, Navigate, Outlet, redirect } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { expectHost } from "~/components/shared/dialog-bus";
import { legacyTarget } from "~/shared/kernel/legacy-routes";

// Tải ngay khi nạp route gốc; confirm/prompt gọi sớm chờ host (dialog-bus.expectHost).
const hostChunk = import("~/components/shared/dialog-host");
expectHost(hostChunk);
const DialogHost = lazy(() => hostChunk.then((m) => ({ default: m.DialogHost })));
const Toaster = lazy(() => import("~/components/ui/sonner").then((m) => ({ default: m.Toaster })));

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

export const Route = createRootRoute({
  // CR-119 phần 2: URL SHT cũ ở gốc (/overview, /contracts/<id>, /partners…) → URL mới dưới /contracts (bookmark, email, thông báo cũ).
  beforeLoad: ({ location }) => {
    const to = legacyTarget(location.href);
    if (to) throw redirect({ href: to, replace: true });
  },
  component: Root,
  notFoundComponent: () => <Navigate to="/contracts" replace />,
});
