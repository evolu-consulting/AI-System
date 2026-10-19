// PK-FR-10 · TF5 · route khung /contracts/$id (nội dung ở HD2).
import { createFileRoute } from "@tanstack/react-router";
import { StubPage } from "~/features/shell/components/StubPage";

export const Route = createFileRoute("/_authed/contracts/$id")({
  component: () => <StubPage titleKey="contracts.pages.detail" />,
});
