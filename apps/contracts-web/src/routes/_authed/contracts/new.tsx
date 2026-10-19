// PK-FR-10 · TF5 · route khung /contracts/new (nội dung ở HD2).
import { createFileRoute } from "@tanstack/react-router";
import { StubPage } from "~/features/shell/components/StubPage";

export const Route = createFileRoute("/_authed/contracts/new")({
  component: () => <StubPage titleKey="contracts.pages.new" />,
});
