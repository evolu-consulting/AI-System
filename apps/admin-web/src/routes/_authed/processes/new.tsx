// ADM-FR-66 · CR-056 · P-a: `/processes/new` — editor tạo quy trình (PF4).
import { createFileRoute } from "@tanstack/react-router";
import { ProcessEditorPage } from "@/features/processes/pages/ProcessEditorPage";

export const Route = createFileRoute("/_authed/processes/new")({
  component: () => <ProcessEditorPage />,
});
