// HUB-FR-101 · X2b D6, D9, §4: khối kết quả của agent trong timeline phòng. Vai theo từng lượt (`caller`), không theo
// quyền agent. Lỗi → câu chung cho cả phòng (không lộ quota, R16); huỷ (Dừng / mất quyền) → "Đã huỷ" cho mọi người.
// "Trả lời tiếp" luôn bật cho mọi thành viên (mở thread `?flow=`). F3: phần chờ (`AgentWait`); `side_effect` đang chờ với
// người khác chỉ còn WaitingNote (ẩn thân); "Chạy lại" (lỗi/huỷ) chỉ cho người gửi lượt.
import type { RoomMessage } from "@ai/contracts/chat";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { AnswerBody } from "~/features/answer/components/AnswerBody";
import { FlowFooter } from "~/features/thread/components/FlowFooter";
import { relativeTime } from "~/features/thread/lib/thread-logic";
import { agentName } from "../../lib/room-agent";
import { timeOf } from "../../lib/room-logic";
import { AgentBlockHeader } from "./AgentBlockHeader";
import { AgentWait } from "./AgentWait";

type Props = {
  message: RoomMessage;
  myId: string;
  /** Mở thread của khối (`?flow=`); vắng `flow_id` → không có nút. */
  onReply?: (flowId: string) => void;
  /** Lượt của tin này còn chờ trả lời/xác nhận (`active_runs` status=waiting). */
  waiting?: boolean;
  onAnswer?: (message: RoomMessage, choice: string) => Promise<boolean>;
  /** "Chạy lại" của người gửi lượt; vắng → không có nút. */
  onRerun?: (message: RoomMessage) => void;
};

function Body({ message, onRerun }: { message: RoomMessage; onRerun?: () => void }) {
  const { t } = useTranslation();
  if (message.run_status === "failed" || message.run_status === "cancelled") {
    const key = message.run_status === "failed" ? "roomAgent.failed" : "roomAgent.cancelledOther";
    return (
      <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>{t(key)}</span>
        {onRerun && (
          <button type="button" onClick={onRerun} className="underline hover:text-foreground">
            {t("run.rerun")}
          </button>
        )}
      </p>
    );
  }
  return (
    <div className="leading-relaxed">
      <AnswerBody content={message.content} streaming={false} />
    </div>
  );
}

/** Nhãn theo vai của lượt (D6, D9): tên agent, "<B> hỏi"/"Bạn hỏi", "Chạy bằng quyền của …". */
function useTurnLabels(message: RoomMessage, myId: string) {
  const { t, i18n } = useTranslation();
  const caller = message.caller;
  const mine = caller?.id === myId;
  const who = { name: caller?.display_name ?? "" };
  return {
    name: agentName(message.agent, i18n.language, t("roomAgent.orchestratorName")),
    caller,
    mine,
    askedBy: mine ? t("roomAgent.askedByMe") : t("roomAgent.askedBy", who),
    runsAs: mine ? t("roomAgent.runsAsMe") : t("roomAgent.runsAs", who),
  };
}

function AgentBlockImpl({ message, myId, onReply, waiting = false, onAnswer, onRerun }: Props) {
  const { t, i18n } = useTranslation();
  const { name, caller, mine, askedBy, runsAs } = useTurnLabels(message, myId);
  const flowId = message.flow_id;
  const ok = message.run_status === undefined || message.run_status === "finished";
  // Q5: người khác không thấy mô tả hành động đang chờ xác nhận — chỉ WaitingNote.
  const hideBody = !mine && waiting && message.ask?.kind === "side_effect";
  return (
    <article
      aria-label={t(hideBody ? "roomAgent.blockWaiting" : "roomAgent.block", { name })}
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
      {!hideBody && (
        <Body message={message} onRerun={mine && onRerun ? () => onRerun(message) : undefined} />
      )}
      <AgentWait message={message} name={name} mine={mine} waiting={waiting} onAnswer={onAnswer} />
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
        copyValue={ok && !hideBody ? message.content : ""}
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
