// dlc-dify · section "Hook" (tuỳ chọn) trong Sửa agent: mỗi loại hook giống Claude CLI (SessionStart, UserPromptSubmit,
// PreToolUse, …) chọn một workflow Dify (catalog Admin, loại `workflow`) hoặc "Không dùng"; [Lưu] riêng như KnowledgeHub.
import { AGENT_HOOK_EVENTS, type Agent } from "@ai/contracts/studio";
import { useTranslation } from "react-i18next";
import { ConflictDialog } from "#/components/shared/conflict/ConflictDialog";
import { Alert, AlertDescription } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { useAgentHooks } from "../../hooks/use-agent-hooks";
import type { Catalog, WorkflowItem } from "../../hooks/use-editor-catalogs";

type Props = {
  agent: Agent;
  version: number;
  onSynced: (a: Agent) => void;
  workflows: Catalog<WorkflowItem>;
};
const NONE = "__none__";

export function AgentHooksSection({ agent, version, onSynced, workflows }: Props) {
  const { t } = useTranslation();
  const h = useAgentHooks({ agent, version, onSynced });
  const flows = workflows.items.filter((w) => w.app_type === "workflow");
  return (
    <section
      aria-labelledby="agent-hooks-title"
      className="space-y-3 rounded-lg border border-border p-4"
    >
      <h3 id="agent-hooks-title" className="text-section-title">
        {t("agents.hooks.title")}
      </h3>
      <p className="text-body text-muted-foreground">{t("agents.hooks.hint")}</p>
      {h.error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{t(h.error.key, h.error.params)}</AlertDescription>
        </Alert>
      ) : null}
      {workflows.failed ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{t("agents.hooks.loadFailed")}</AlertDescription>
        </Alert>
      ) : null}
      <ul className="space-y-2">
        {AGENT_HOOK_EVENTS.map((event) => {
          const id = `agent-hook-${event}`;
          return (
            <li
              key={event}
              className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[14rem_1fr]"
            >
              <label htmlFor={id} className="font-mono text-label">
                {event}
              </label>
              <Select
                value={h.map[event] ?? NONE}
                onValueChange={(v) => h.pick(event, v === NONE ? null : v)}
                disabled={workflows.pending}
              >
                <SelectTrigger id={id} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("agents.hooks.none")}</SelectItem>
                  {flows.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name} ({w.key})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </li>
          );
        })}
      </ul>
      {h.dirty ? (
        <div className="flex justify-end">
          <Button type="button" disabled={h.saving} onClick={() => void h.save()}>
            {h.saving ? t("agents.hooks.saving") : t("agents.hooks.save")}
          </Button>
        </div>
      ) : null}
      {h.conflictProps ? <ConflictDialog {...h.conflictProps} /> : null}
    </section>
  );
}
