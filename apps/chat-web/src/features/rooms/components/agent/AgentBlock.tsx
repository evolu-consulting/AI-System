// HUB-FR-101 · X2b D6, D9, §4: khối kết quả của agent trong timeline phòng. Vai theo từng lượt (`caller`), không theo
// quyền agent. Lỗi → câu chung cho cả phòng (không lộ quota, R16); huỷ (Dừng / mất quyền) → "Đã huỷ" cho mọi người.
// "Trả lời tiếp" luôn bật cho mọi thành viên (mở thread `?flow=`).
import type { RoomMessage } from "@ai/contracts/chat";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { AnswerBody } from "~/features/answer/components/AnswerBody";
import { FlowFooter } from "~/features/thread/components/FlowFooter";
import { relativeTime } from "~/features/thread/lib/thread-logic";
import { agentName } from "../../lib/room-agent";
import { timeOf } from "../../lib/room-logic";
import { AgentBlockHeader } from "./AgentBlockHeader";

type Props = {
  message: RoomMessage;
  myId: string;
  /** Mở thread của khối (`?flow=`); vắng `flow_id` → không có nút. */
  onReply?: (flowId: string) => void;
};

function Body({ message }: { message: RoomMessage }) {
  const { t } = useTranslation();
  if (message.run_status === "failed") {
    return <p className="text-sm text-muted-foreground">{t("roomAgent.failed")}</p>;
  }
  if (message.run_status === "cancelled") {
    return <p className="text-sm text-muted-foreground">{t("roomAgent.cancelledOther")}</p>;
  }
  return (
    <div className="leading-relaxed">
      <AnswerBody content={message.content} streaming={false} />
    </div>
  );
}

function AgentBlockImpl({ message, myId, onReply }: Props) {
  const { t, i18n } = useTranslation();
  const name = agentName(message.agent, i18n.language, t("roomAgent.orchestratorName"));
  const caller = message.caller;
  const mine = caller?.id === myId;
  const askedBy = mine
    ? t("roomAgent.askedByMe")
    : t("roomAgent.askedBy", { name: caller?.display_name ?? "" });
  const runsAs = mine
    ? t("roomAgent.runsAsMe")
    : t("roomAgent.runsAs", { name: caller?.display_name ?? "" });
  const flowId = message.flow_id;
  const ok = message.run_status === undefined || message.run_status === "finished";
  return (
    <article
      aria-label={t("roomAgent.block", { name })}
      data-seq={message.seq}
      data-flow-id={flowId}
      className="my-2 flex flex-col gap-3 rounded-[14px] border border-border bg-card p-4"
    >
      <AgentBlockHeader
        name={name}
        agentKey={message.agent?.key}
        askedBy={caller ? askedBy : ""}
        time={timeOf(message.created_at)}
      />
      <Body message={message} />
      <p className="flex flex-wrap gap-x-2 text-caption text-muted-foreground">
        {message.steps && (
          <span>
            {t("roomAgent.steps", {
              count: message.steps.count,
              seconds: Math.round(message.steps.ms / 100) / 10,
            })}
          </span>
        )}
        {caller && <span>{runsAs}</span>}
      </p>
      <FlowFooter
        copyValue={ok ? message.content : ""}
        messageCount={message.flow?.message_count ?? 0}
        timeLabel={
          message.flow ? relativeTime(message.flow.last_active_at, Date.now(), i18n.language) : null
        }
        openHere={false}
        busy={false}
        onReply={flowId && onReply ? () => onReply(flowId) : undefined}
      />
    </article>
  );
}

export const AgentBlock = memo(AgentBlockImpl);
