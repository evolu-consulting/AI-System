import { createFileRoute } from "@tanstack/react-router";
import { WorkflowStepsPage } from "@/features/dlc-admin/pages/WorkflowStepsPage";

// DLC-R15 · Workflows › Workflow Steps (các bước AI SDLC).
export const Route = createFileRoute("/_authed/workflows/steps")({
  component: WorkflowStepsPage,
});
