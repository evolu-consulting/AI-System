// CR-118/CR-120 · `/community/*` nằm TRONG vùng `_authed` ⇒ dùng chung MỘT AppShell với Sổ Hợp Tác (không còn khung riêng); đối tác
// (không có gói contracts) vẫn vào được vì cổng gói contracts chỉ bọc `/contracts/*` (routes/_authed/contracts.tsx). Component + module
// náp LƯỜI (chunk `community`). Route con (`/community`, `/community/$`) rỗng — module tự đọc URL qua RouterPort.
import { createFileRoute } from "@tanstack/react-router";
import { CommunityRoute } from "~/shell/CommunityRoute";

export const Route = createFileRoute("/_authed/community")({
  component: CommunityRoute,
});
