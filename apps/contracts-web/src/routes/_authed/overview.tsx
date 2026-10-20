// nav-v2: /overview — Tổng quan (trang đầu): việc cần xử lý, hợp đồng, đối tác cần xem lại.
import { createFileRoute } from "@tanstack/react-router";
import { OverviewPage } from "~/features/overview/pages/OverviewPage";

export const Route = createFileRoute("/_authed/overview")({ component: OverviewPage });
