// PK-FR-10 · TF4 · layout cần đăng nhập: tải trang → refresh cookie một lần; không có phiên → `/login?next=`;
// có phiên → cổng gói (`/pack/contracts/me`) rồi tới Shell (TF5).
import { createFileRoute } from "@tanstack/react-router";
import { PackFrame } from "~/features/pack-state/pages/PackFrame";

export const Route = createFileRoute("/_authed")({
  // Guard nạp động: phiên web-kit (+ `@ai/contracts/chat`) ra khỏi bundle đầu (plan-frontend §8).
  beforeLoad: async ({ location }) =>
    (await import("~/features/auth/lib/guard")).requireSession(location),
  component: PackFrame,
});
