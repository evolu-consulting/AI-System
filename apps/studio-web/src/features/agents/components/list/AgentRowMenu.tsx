// HUB-FR-60 · HUB-FR-62 · H4a-R06, R07, R12 · menu ⋯: Nhân bản, Đặt làm Orchestrator (ẩn khi runtime ∉ ORCHESTRATOR_RUNTIMES),
// Bật/Tắt, Xoá (khoá khi đang là Orchestrator). Playground / Cấp cho tenant: disabled "Sắp có".
import type { AgentListItem } from "@ai/contracts/studio";
import { useRouter } from "@tanstack/react-router";
import { Ellipsis } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "#/components/shared/ConfirmDialog";
import { SoonBadge } from "#/components/shared/SoonBadge";
import { Button } from "#/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { withBase } from "#/lib/env";
import { canSetAsOrchestrator, isOrchestrator } from "../../lib/status";

type Props = {
  agent: AgentListItem;
  name: string;
  onToggle: () => void;
  onSetOrchestrator: () => void;
  onDelete: () => void;
};
type Dialog = "orch" | "delete" | null;

export function AgentRowMenu({ agent, name, onToggle, onSetOrchestrator, onDelete }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const locked = isOrchestrator(agent);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("agents.rowMenu", { key: agent.key })}
          >
            <Ellipsis aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() =>
              void router.navigate({ href: withBase(`/agents/new?from=${agent.id}`) })
            }
          >
            {t("agents.menu.duplicate")}
          </DropdownMenuItem>
          {canSetAsOrchestrator(agent) ? (
            <DropdownMenuItem onSelect={() => setDialog("orch")}>
              {t("agents.menu.setOrch")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem disabled>
            {t("agents.menu.playground")} <SoonBadge kind="soonH4c" />
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            {t("agents.menu.grant")} <SoonBadge kind="soonH4b" />
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={locked} onSelect={onToggle}>
            {agent.enabled ? t("agents.menu.disable") : t("agents.menu.enable")}
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            disabled={locked}
            onSelect={() => setDialog("delete")}
          >
            {t("agents.menu.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={dialog === "orch"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("agents.setOrch.title", { name })}
        body={t("agents.setOrch.body")}
        confirmLabel={t("agents.setOrch.confirm")}
        onConfirm={onSetOrchestrator}
      />
      <ConfirmDialog
        open={dialog === "delete"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("agents.delete.title", { key: agent.key })}
        body={t("agents.delete.body")}
        confirmLabel={t("agents.delete.confirm")}
        destructive
        onConfirm={onDelete}
      />
    </>
  );
}
