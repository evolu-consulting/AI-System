// HUB-FR-60 · H4a-R03, R09, R12 · form Agent editor 5 bước (AgentEditor): header, 5 thẻ, thanh Huỷ/Lưu, UnsavedGuard, ConflictDialog.
// Phần runtime chi tiết (CliOptions, WorkflowPicker, SchemaForm) nằm ở component riêng — F5 mở rộng tại đó.
import type { Agent } from "@ai/contracts/studio";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ConflictDialog } from "#/components/shared/conflict/ConflictDialog";
import { PageHeader } from "#/components/shared/PageHeader";
import { SoonBadge } from "#/components/shared/SoonBadge";
import { UnsavedGuard } from "#/components/shared/UnsavedGuard";
import { Alert, AlertDescription } from "#/components/ui/alert";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { useAgentEditor } from "../hooks/use-agent-editor";
import { useAgentPeers } from "../hooks/use-agent-peers";
import { useEditorCatalogs } from "../hooks/use-editor-catalogs";
import type { AgentDraft } from "../lib/draft";
import { AccessSection } from "./AccessSection";
import { DetailsSection } from "./DetailsSection";
import { OrchestratorView } from "./OrchestratorView";
import { PromptSection } from "./PromptSection";
import { RuntimeSection } from "./RuntimeSection";
import { StepCard } from "./StepCard";
import { WorkflowSection } from "./WorkflowSection";

type Props = { initial: AgentDraft; agent?: Agent };

/** Lỗi đầu tiên (aria-invalid) nhận focus sau khi bấm Lưu. */
function useFocusFirstInvalid(errors: object): void {
  useEffect(() => {
    if (Object.keys(errors).length > 0)
      document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);
}

export function EditorForm({ initial, agent }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const ed = useAgentEditor({ initial, agent });
  const cat = useEditorCatalogs();
  const { peers, self } = useAgentPeers(agent?.id);
  useFocusFirstInvalid(ed.errors);
  useEffect(() => {
    if (ed.createdId)
      void navigate({ to: "/agents/$agentId", params: { agentId: ed.createdId }, replace: true });
  }, [ed.createdId, navigate]);

  const section = { draft: ed.draft, set: ed.set, errors: ed.errors, mode: ed.mode };
  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" disabled>
        {t("editor.tryRun")} <SoonBadge kind="soonH4c" />
      </Button>
      <OrchestratorView draftKey={ed.draft.key} description={ed.draft.description} peers={peers} />
    </div>
  );
  return (
    <form
      noValidate
      className="space-y-4 pb-24"
      onSubmit={(e) => {
        e.preventDefault();
        void ed.save();
      }}
    >
      <PageHeader
        title={t(ed.mode === "new" ? "editor.titleNew" : "editor.titleEdit")}
        actions={actions}
      />
      {ed.invalid ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{t("editor.err.invalid")}</AlertDescription>
        </Alert>
      ) : null}
      <StepCard n={1}>
        <DetailsSection {...section} />
      </StepCard>
      <StepCard n={2}>
        <RuntimeSection
          {...section}
          hadBash={ed.hadBash}
          profiles={cat.profiles}
          agentTypes={cat.agentTypes}
        />
      </StepCard>
      <StepCard n={3}>
        <WorkflowSection {...section} workflows={cat.workflows} attached={agent?.workflows ?? []} />
      </StepCard>
      <StepCard n={4}>
        <PromptSection {...section} />
      </StepCard>
      <StepCard n={5}>
        <AccessSection granted={self?.entitled_tenant_count ?? 0} />
      </StepCard>
      <div className="fixed inset-x-0 bottom-0 z-10 flex items-center justify-end gap-3 border-t border-border bg-card px-6 py-3">
        {ed.dirty ? <Badge variant="secondary">{t("editor.dirty")}</Badge> : null}
        <Button type="button" variant="outline" onClick={() => void navigate({ to: "/agents" })}>
          {t("editor.cancel")}
        </Button>
        <Button type="submit" disabled={ed.saving}>
          {ed.saving ? t("editor.saving") : t("editor.save")}
        </Button>
      </div>
      <UnsavedGuard dirty={ed.dirty} />
      {ed.conflictProps ? <ConflictDialog {...ed.conflictProps} /> : null}
    </form>
  );
}
