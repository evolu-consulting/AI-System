// PK-FR-10 · TF5 · route khung /cks/$id (nội dung ở HD9).
import { createFileRoute } from "@tanstack/react-router";
import { StubPage } from "~/features/shell/components/StubPage";

export const Route = createFileRoute("/_authed/cks/$id")({
  component: () => <StubPage titleKey="contracts.pages.productDetail" />,
});
