// GAP-E #30 · `/privacy`: Chính sách bảo mật (công khai).
import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "~/features/legal/pages/LegalPage";

export const Route = createFileRoute("/privacy")({
  component: () => <LegalPage kind="privacy" />,
});
