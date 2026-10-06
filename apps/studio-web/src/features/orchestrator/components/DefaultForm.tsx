// HUB-FR-62 · H4a-R07, R08, R09 · form bản mặc định (inline): chọn agent + tham số, cảnh báo "Chậm", Lưu, hộp xung đột 409.
import type { Orchestrator } from "@ai/contracts/studio";
import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ConflictDialog } from "#/components/shared/conflict/ConflictDialog";
import { UnsavedGuard } from "#/components/shared/UnsavedGuard";
import { Alert, AlertDescription } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import { useOrchEditor } from "../hooks/use-orch-editor";
import type { SaveVars } from "../hooks/use-orch-mutations";
import { type AgentOption, fromOrch } from "../lib/draft";
import { OrchFields } from "./OrchFields";

export function SlowAlert() {
  const { t } = useTranslation();
  return (
    <Alert className="border-transparent bg-warning-bg text-warning">
      <TriangleAlert aria-hidden />
      <AlertDescription className="text-warning">{t("orch.slow")}</AlertDescription>
    </Alert>
  );
}

type Props = {
  value: Orchestrator;
  options: AgentOption[];
  save: (v: SaveVars) => Promise<unknown>;
  reload: () => void;
};

export function DefaultForm({ value, options, save, reload }: Props) {
  const { t } = useTranslation();
  const ed = useOrchEditor({
    source: fromOrch(value),
    version: value.version,
    save,
    reload,
    agentName: (id) => options.find((o) => o.id === id)?.key ?? id,
  });
  const runtime = options.find((o) => o.id === ed.draft.agentId)?.runtime;
  const slow = runtime ? runtime === "agentic-cli" : value.warnings.includes("agentic_cli_slow");
  return (
    <section
      aria-labelledby="orch-default"
      className="space-y-4 rounded-lg border border-border bg-card p-5"
    >
      <h2 id="orch-default" className="text-section-title font-semibold">
        {t("orch.default")}
      </h2>
      {slow ? <SlowAlert /> : null}
      <form
        className="max-w-xl space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void ed.submit();
        }}
      >
        <OrchFields idp="d" draft={ed.draft} set={ed.set} errors={ed.errors} options={options} />
        <Button type="submit" disabled={ed.saving}>
          {t("orch.save")}
        </Button>
      </form>
      <UnsavedGuard dirty={ed.dirty} />
      {ed.conflict ? <ConflictDialog {...ed.conflict} /> : null}
    </section>
  );
}
