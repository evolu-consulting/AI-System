// Khung chờ: màn Orchestrator là task sau.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PageHeader } from "#/components/shared/PageHeader";

export const Route = createFileRoute("/_authed/orchestrator")({
  component: function OrchestratorPlaceholder() {
    const { t } = useTranslation();
    return <PageHeader title={t("nav.orchestrator")} />;
  },
});
