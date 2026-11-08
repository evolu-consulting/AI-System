// CR-125 · cr125-manual-start-ui · /contracts/requests — «Tạo yêu cầu»: loại yêu cầu bắt đầu bằng phiếu + việc chờ tôi.
import { createFileRoute } from "@tanstack/react-router";
import { RequestsPage } from "~/features/requests/pages/RequestsPage";

export const Route = createFileRoute("/_authed/contracts/requests/")({ component: RequestsPage });
