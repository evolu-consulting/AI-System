// PK-FR-10 · TF1 · `/contracts` — route rỗng; danh sách ở HD5.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

function ContractsRoute() {
  const { t } = useTranslation();
  return (
    <main className="p-page">
      <h1 className="text-page-title">{t("contracts.contractsPage.title")}</h1>
    </main>
  );
}

export const Route = createFileRoute("/contracts")({ component: ContractsRoute });
