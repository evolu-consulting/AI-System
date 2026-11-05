// PK-FR-10 · TF1 · route gốc: Outlet + Toaster dùng chung; đường lạ → `/contracts` (plan-frontend §1).
// CR-118 bundle: DialogHost (radix dialog) + Toaster (sonner) tải lười — không nằm trong JS ban đầu.
import { createRootRoute, Navigate, Outlet } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { expectHost } from "~/components/shared/dialog-bus";

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
  component: Root,
  notFoundComponent: () => <Navigate to="/contracts" replace />,
});
