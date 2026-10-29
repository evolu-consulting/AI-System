// CR-103 · R4 fnr-showcase: `/processes/showcase` — trang mẫu flow (canvas chỉ đọc + chạy thử + duyệt tại chỗ).
import { createFileRoute } from "@tanstack/react-router";
import { ShowcasePage } from "@/features/processes/pages/ShowcasePage";

export const Route = createFileRoute("/_authed/processes/showcase")({
  component: ShowcasePage,
});
