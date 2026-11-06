// CR-121 R6 · c16 · /ai-tools — MỘT danh sách công cụ AI (workflow Dify) kèm "Dùng bởi"; chip lọc, ô tìm, ngăn chi tiết có "Công ty dùng".
// Chỉ platform_admin (vai khác thấy ForbiddenState, không gọi API). Bộ lọc + công cụ đang mở nằm trên URL.
import { Link } from "@tanstack/react-router";
import { Bot, Terminal, Workflow } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { PlatformOnly } from "@/components/shared/PlatformOnly";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/http";
import { AiToolDrawer } from "../components/AiToolDrawer";
import { AiToolsEmpty } from "../components/AiToolsEmpty";
import { AiToolsTable } from "../components/AiToolsTable";
import { AiToolsToolbar } from "../components/AiToolsToolbar";
import { useAiToolsView } from "../hooks/use-ai-tools-view";
import { useWorkflowRowActions } from "../hooks/use-workflow-row-actions";

function loadError(e: Error | null) {
  if (!e) return null;
  return { message: e.message, code: e instanceof ApiError ? String(e.code) : "NETWORK_ERROR" };
}

function AiToolsContent() {
  const { t } = useTranslation();
  const v = useAiToolsView();
  const wf = useWorkflowRowActions();
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("aiTools.title")}
        hint={t("aiTools.hint")}
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link to="/commands/new">{t("aiTools.createCommand")}</Link>
            </Button>
            <Button asChild>
              <Link to="/workflows/new">{t("aiTools.create")}</Link>
            </Button>
          </div>
        }
      />
      {v.notice === "company-tools" ? (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            {t("aiTools.notice.companyTools")}
            <Button variant="link" size="sm" onClick={() => v.patch({ notice: undefined })}>
              {t("common.close")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      <AiToolsToolbar
        filters={v.filters}
        counts={v.counts}
        onStatus={(status) => v.refilter({ status })}
        onKind={(kind) => v.refilter({ kind })}
        onQuery={(q) => v.refilter({ q: q || undefined })}
        onSecret={(secret) => v.refilter({ secret })}
      />
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <AiToolsTable
          rows={v.page?.rows}
          isLoading={v.usage.isPending}
          isFetching={v.usage.isFetching}
          error={loadError(v.usage.error)}
          onRetry={() => void v.usage.refetch()}
          empty={
            <AiToolsEmpty
              filters={v.filters}
              onClear={() =>
                v.refilter({ status: undefined, kind: undefined, q: undefined, secret: undefined })
              }
            />
          }
          activeId={v.activeId}
          workflowActions={wf}
          onOpen={(x) => v.patch({ tool: x.id })}
        />
        {v.total > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-caption text-muted-foreground tabular-nums">
            <span>
              <span aria-live="polite">
                {t("aiTools.shown", { shown: v.page?.rows.length ?? 0, total: v.total })}
              </span>
              {v.page?.more ? (
                <Button variant="link" size="sm" className="ml-2" onClick={v.more}>
                  {t("aiTools.more")}
                </Button>
              ) : null}
            </span>
            <span className="inline-flex items-center gap-3.5">
              <span className="inline-flex items-center gap-1.5">
                <Bot aria-hidden className="size-3.5" />
                {t("aiTools.legend.agent")}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Terminal aria-hidden className="size-3.5" />
                {t("aiTools.legend.command")}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Workflow aria-hidden className="size-3.5" />
                {t("aiTools.legend.workflow")}
              </span>
            </span>
          </div>
        ) : null}
      </div>
      <AiToolDrawer
        tool={v.active}
        onClose={() => v.patch({ tool: undefined })}
        workflowActions={wf}
      />
      {wf.dialogs}
    </div>
  );
}

export function AiToolsPage() {
  return (
    <PlatformOnly>
      <AiToolsContent />
    </PlatformOnly>
  );
}
