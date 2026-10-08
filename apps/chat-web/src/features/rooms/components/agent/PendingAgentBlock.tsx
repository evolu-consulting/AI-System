// HUB-FR-101 · X2b D7–D9: khối "<agent> đang xử lý…" cuối timeline. Người gửi lượt: stream chữ (driver C1) + "Dừng";
// người khác: chỉ trạng thái + "Chỉ <B> dừng được" (Q1). Nhiều run song song → nhiều khối.
import { Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { Answer } from "~/features/thread/components/FlowBlock";
import type { AnswerView } from "~/features/thread/lib/thread-logic";
import { AgentBlockHeader } from "./AgentBlockHeader";

export type PendingAgentBlockProps = {
  runId: string;
  flowId: string;
  name: string;
  agentKey?: string;
  callerName: string;
  /** Mình là người gửi lượt này. */
  mine: boolean;
  /** Stream của người gửi lượt (null khi chưa có / người khác). */
  answer: AnswerView | null;
  stopping: boolean;
  onStop(): void;
};

export function PendingAgentBlock(p: PendingAgentBlockProps) {
  const { t } = useTranslation();
  const showText = p.answer !== null && (p.answer.text !== "" || !p.answer.waiting);
  return (
    <article
      aria-label={t("roomAgent.block", { name: p.name })}
      data-run-id={p.runId}
      data-flow-id={p.flowId}
      className="my-2 flex flex-col gap-3 rounded-[14px] border border-primary/40 bg-card p-4"
    >
      <AgentBlockHeader
        name={p.name}
        agentKey={p.agentKey}
        askedBy={p.mine ? t("roomAgent.askedByMe") : t("roomAgent.askedBy", { name: p.callerName })}
      />
      {showText && p.answer ? (
        <Answer answer={p.answer} />
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          {t("roomAgent.working", { agent: p.name })}
        </p>
      )}
      <div className="flex items-center gap-2 border-t border-row-divider pt-2.5">
        {p.mine ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-[30px] gap-1.5 rounded-full px-3 text-caption"
            disabled={p.stopping}
            onClick={p.onStop}
          >
            <Square className="size-3" aria-hidden />
            {t("composer.stop")}
          </Button>
        ) : (
          <span className="text-caption text-muted-foreground">
            {t("roomAgent.onlyCallerStop", { name: p.callerName })}
          </span>
        )}
      </div>
    </article>
  );
}
