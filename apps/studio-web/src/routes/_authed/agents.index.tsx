// Khung chờ: danh sách agent là task sau (F4).
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PageHeader } from "#/components/shared/PageHeader";

export const Route = createFileRoute("/_authed/agents/")({
  component: function AgentsPlaceholder() {
    const { t } = useTranslation();
    return <PageHeader title={t("nav.agents")} />;
  },
});
