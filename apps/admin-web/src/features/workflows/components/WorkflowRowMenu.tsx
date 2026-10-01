// ADM-FR-13, ADM-FR-14 · menu `⋯` của một workflow: Sửa · Bật/Tắt · Tạo command · Xoá.
import type { WorkflowListItem } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import { MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Props = {
  workflow: WorkflowListItem;
  onToggle: (w: WorkflowListItem) => void;
  onDelete: (w: WorkflowListItem) => void;
};

export function WorkflowRowMenu({ workflow, onToggle, onDelete }: Props) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("common.moreActions")}>
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link to="/workflows/$workflowId" params={{ workflowId: workflow.id }}>
            {t("workflows.menu.edit")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onToggle(workflow)}>
          {t(workflow.enabled ? "workflows.menu.disable" : "workflows.menu.enable")}
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/commands/new" search={{ workflow: workflow.id }}>
            {t("workflows.menu.createCommand")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onDelete(workflow)}>
          {t("workflows.menu.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
