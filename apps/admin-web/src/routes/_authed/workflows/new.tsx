// ADM-FR-10 · M2 · stub route (FE1a): chỉ PageHeader trong PlatformOnly; màn thật thay ở task FE sau.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { PlatformOnly } from "@/components/shared/PlatformOnly";

function Stub() {
  const { t } = useTranslation();
  return (
    <PlatformOnly>
      <PageHeader title={t("workflows.editor.titleNew")} />
    </PlatformOnly>
  );
}

export const Route = createFileRoute("/_authed/workflows/new")({ component: Stub });
