// CR-181 · s4 · `/my-signature` — «Chữ ký của tôi» (khu tài khoản, mở từ menu người dùng). Trang nạp lười.
import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const Page = lazy(() => import("~/features/my-signature/pages/MySignaturePage"));

export const Route = createFileRoute("/_authed/my-signature")({
  component: () => (
    <Suspense fallback={null}>
      <Page />
    </Suspense>
  ),
});
