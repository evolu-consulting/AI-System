// CR-118 · `/community/*` — route khung ngoài vùng `_authed` (PackFrame cổng gói contracts, đối tác không có), guard của platform/auth
// (phiên chung, không dội sang AI System, quyền module theo /pack/me.apps). Component + module nạp LƯỜI (chunk `community`): bundle đầu
// chỉ chứa phần khung này. Route con (`/community`, `/community/$`) rỗng — module tự đọc URL qua RouterPort (manifest.communityRoutes mô tả
// cấu trúc; `createCommunityRoutes` dùng cho router gộp mã-route khi cần).
import { createFileRoute } from "@tanstack/react-router";
import { CommunityRoute } from "~/shell/CommunityRoute";

export const Route = createFileRoute("/community")({
  beforeLoad: async ({ location }) =>
    (await import("~/features/auth/lib/guard")).requireSession(location),
  component: CommunityRoute,
});
