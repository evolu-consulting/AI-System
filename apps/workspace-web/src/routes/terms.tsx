// GAP-E #30 · `/terms`: Điều khoản sử dụng (công khai).
import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "~/features/legal/pages/LegalPage";

export const Route = createFileRoute("/terms")({
  component: () => <LegalPage kind="terms" />,
});
