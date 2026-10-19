// PK-FR-10 · TF5 · route khung /cks/ (nội dung ở HD9).
import { createFileRoute } from "@tanstack/react-router";
import { StubPage } from "~/features/shell/components/StubPage";

export const Route = createFileRoute("/_authed/cks/")({
  component: () => <StubPage titleKey="contracts.pages.products" />,
});
