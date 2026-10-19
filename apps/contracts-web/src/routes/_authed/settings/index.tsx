// PK-FR-10 · TF5 · route khung /settings/ (nội dung ở HD8).
import { createFileRoute } from "@tanstack/react-router";
import { StubPage } from "~/features/shell/components/StubPage";

export const Route = createFileRoute("/_authed/settings/")({
  component: () => <StubPage titleKey="contracts.pages.settings" />,
});
