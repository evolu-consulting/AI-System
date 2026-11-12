// CR-118/CR-120 · `/community/*` nằm TRONG vùng `_authed` ⇒ dùng chung MỘT AppShell với Sổ Hợp Tác (không còn khung riêng); đối tác
// (không có gói contracts) vẫn vào được vì cổng gói contracts chỉ bọc `/contracts/*` (routes/_authed/contracts.tsx). Component + module
// náp LƯỜI (chunk `community`). Route con (`/community`, `/community/$`) rỗng — module tự đọc URL qua RouterPort.
// CR-130 · link cũ `?settings=1` (và `#/settings`) ⇒ mở hộp thoại Cài đặt chung ở mục Bảng tin rồi về trang không có `?settings`.
import { createFileRoute, redirect } from "@tanstack/react-router";
import { isLegacySettingsLink } from "~/modules/community/manifest";
import { CommunityRoute } from "~/shell/CommunityRoute";

export const Route = createFileRoute("/_authed/community")({
  beforeLoad: async ({ location }) => {
    if (!isLegacySettingsLink(location.search)) return;
    (await import("~/features/settings/lib/bus")).openSettings("feed");
    throw redirect({ href: location.pathname, replace: true });
  },
  component: CommunityRoute,
});
