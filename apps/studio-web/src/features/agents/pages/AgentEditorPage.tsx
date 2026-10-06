// HUB-FR-60 · H4a-R03, R12 · màn Agent editor: tạo (`/agents/new`), nhân bản (`?from=<id>`), sửa (`/agents/$agentId`).
// Tải agent nguồn → dựng nháp; 404 → NotFound; lỗi khác → ErrorState + Thử lại.
import { useTranslation } from "react-i18next";
import { EmptyState } from "#/components/shared/EmptyState";
import { ErrorState } from "#/components/shared/ErrorState";
import { HrefLink } from "#/components/shared/HrefLink";
import { PageHeader } from "#/components/shared/PageHeader";
import { buttonVariants } from "#/components/ui/button";
import { Skeleton } from "#/components/ui/skeleton";
import { EditorForm } from "../components/editor/EditorForm";
import { useAgentSource } from "../hooks/use-agent-source";
import { cloneDraft, emptyDraft, fromAgent } from "../lib/draft/draft";

type Props = { agentId?: string; from?: string };

const codeOf = (e: unknown) => (e as { code?: unknown } | null)?.code;

export function AgentEditorPage({ agentId, from }: Props) {
  const { t } = useTranslation();
  const src = useAgentSource(agentId ?? from);
  if (src.error) {
    if (codeOf(src.error) === "NOT_FOUND")
      return (
        <EmptyState
          message={t("notFound.title")}
          action={
            <HrefLink path="/agents" className={buttonVariants()}>
              {t("notFound.back")}
            </HrefLink>
          }
        />
      );
    return <ErrorState code={String(codeOf(src.error) ?? "") || undefined} onRetry={src.retry} />;
  }
  if (src.pending)
    return (
      <div aria-busy="true" className="space-y-3">
        <PageHeader title={t(agentId ? "editor.titleEdit" : "editor.titleNew")} />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  if (agentId && src.agent) return <EditorForm initial={fromAgent(src.agent)} agent={src.agent} />;
  const initial = src.agent ? cloneDraft(src.agent, t("editor.copySuffix")) : emptyDraft();
  return <EditorForm initial={initial} />;
}
