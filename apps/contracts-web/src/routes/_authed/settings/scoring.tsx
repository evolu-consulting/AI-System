// PK-FR-10 · TF5 · route khung /settings/scoring (nội dung ở HD8).
import { createFileRoute } from "@tanstack/react-router";
import { StubPage } from "~/features/shell/components/StubPage";

export const Route = createFileRoute("/_authed/settings/scoring")({
  component: () => <StubPage titleKey="contracts.pages.scoring" />,
});
