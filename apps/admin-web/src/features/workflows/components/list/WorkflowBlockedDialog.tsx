// ADM-FR-13 · AC-A05 · hộp thoại chặn xoá/tắt workflow: liệt kê command và agent đang dùng (lấy từ `details` của 409).
import type { AgentRef, UsageCommand } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { BlockedDialog } from "@/components/shared/BlockedDialog";
import { DependencyList } from "@/components/shared/DependencyList";
import { useTr } from "@/lib/use-translate";
import { usageSections } from "../../lib/usage";

export type BlockedInfo = {
  action: "delete" | "disable";
  /** Mã workflow (key) để ghép vào câu. */
  workflowKey: string;
  commands: UsageCommand[];
  agents: AgentRef[];
};

export function WorkflowBlockedDialog({
  info,
  onClose,
}: {
  info: BlockedInfo | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const tr = useTr();
  const key = info?.action === "disable" ? "workflows.blocked.disable" : "workflows.delete.blocked";
  return (
    <BlockedDialog
      open={!!info}
      onClose={onClose}
      title={info ? t(key, { key: info.workflowKey }) : ""}
    >
      {info ? <DependencyList sections={usageSections(tr, info.commands, info.agents)} /> : null}
    </BlockedDialog>
  );
}
