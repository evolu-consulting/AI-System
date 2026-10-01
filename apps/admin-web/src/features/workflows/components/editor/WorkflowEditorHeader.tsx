// ADM-FR-14 · AC-A13 · đầu trang editor Workflow: tên (hoặc "Workflow mới"), key mono, badge Chưa gắn/Bật/Tắt, link "Tạo command từ workflow này".
import type { Workflow } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";

export function WorkflowEditorHeader({ workflow }: { workflow?: Workflow }) {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader
        title={workflow ? workflow.name : t("workflows.editor.titleNew")}
        description={workflow?.key}
        actions={
          workflow ? (
            <Button variant="outline" asChild>
              <Link to="/commands/new" search={{ workflow: workflow.id }}>
                {t("workflows.createCommandFrom")}
              </Link>
            </Button>
          ) : null
        }
      />
      {workflow ? (
        <div className="-mt-3 mb-4 flex gap-2">
          {workflow.unattached ? (
            <StatusBadge tone="warn">{t("workflows.unattached")}</StatusBadge>
          ) : null}
          <StatusBadge tone={workflow.enabled ? "ok" : "off"}>
            {t(workflow.enabled ? "common.on" : "common.off")}
          </StatusBadge>
        </div>
      ) : null}
    </>
  );
}
