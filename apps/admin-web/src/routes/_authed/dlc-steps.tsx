import { createFileRoute } from "@tanstack/react-router";
import { DlcStepsPage } from "@/features/processes/pages/DlcStepsPage";

// dlc-step-library · /dlc-steps (chỉ platform_admin): thư viện bước DLC dùng lại cho Canvas khe `dlc.*`.
export const Route = createFileRoute("/_authed/dlc-steps")({ component: DlcStepsPage });
