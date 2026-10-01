// ADM-FR-14, ADM-FR-15 · cột "Đang được dùng bởi": `2 command · 1 agent` mở Popover (usages nạp lười); không dùng → badge "Chưa gắn".
import type { WorkflowListItem } from "@ai/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DependencyList } from "@/components/shared/DependencyList";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { useTr } from "@/lib/use-translate";
import { useWorkflowUsages } from "../hooks/use-workflow-queries";
import { usageSections, usageSummary } from "../lib/usage";

function UsagePanel({ id }: { id: string }) {
  const tr = useTr();
  const usages = useWorkflowUsages(id, true);
  if (usages.isPending) return <Skeleton className="h-16 w-full" />;
  if (usages.isError || !usages.data) return null;
  return <DependencyList sections={usageSections(tr, usages.data.commands, usages.data.agents)} />;
}

export function UsageCell({ workflow }: { workflow: WorkflowListItem }) {
  const { t } = useTranslation();
  const tr = useTr();
  const [open, setOpen] = useState(false);
  if (workflow.unattached)
    return <StatusBadge tone="warn">{t("workflows.unattached")}</StatusBadge>;
  const summary = usageSummary(tr, workflow.command_count, workflow.agent_count);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="link" className="h-auto p-0 text-body">
          {summary}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        {open ? <UsagePanel id={workflow.id} /> : null}
      </PopoverContent>
    </Popover>
  );
}
