// CHAT-AC-52 · plan-frontend-thread §1/§4: khối quy trình ở timeline (dáng AgentBlock + StageStrip) và đầu thread (`inThread`).
// D1 (UAT 2026-10-11): nạp view của run ngay khi khối gắn vào DOM — không chờ `useInView`/mở thread (IntersectionObserver trong khung cuộn
// không bắn đáng tin khi timeline tự cuộn xuống đáy lúc mới mở phòng) ⇒ trạng thái/giai đoạn/huy hiệu hiện từ lần vẽ đầu.
// Lỗi view ⇒ thanh trạng thái báo "stale" + Thử lại (tin vẫn đọc được).

import type { ProcessRunFullView } from "@ai/contracts/chat";
import { Workflow } from "lucide-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { FlowRecent } from "~/features/rooms/components/agent/FlowRecent";
import { FlowFooter } from "~/features/thread/components/FlowFooter";
import { relativeTime } from "~/features/thread/lib/thread-logic";
import { AutofixSummary } from "../../shared/autofix/AutofixSummary";
import { RunStatusBadge } from "../../shared/components/RunStatusBadge";
import { StageStrip } from "../../shared/components/StageStrip";
import { TaskWaitingNote } from "../../shared/components/TaskWaitingNote";
import { useThreadRun } from "../../shared/hooks/use-thread-run";
import type { ThreadMessageProps } from "../../shared/types";
import {
  type BlockAction,
  backTrail,
  latestAutofix,
  myActions,
  stageItems,
  waitingOpenTasks,
} from "../lib/block-view";
import { StatusLine } from "./StatusLine";

export type ProcessBlockProps = ThreadMessageProps<"block"> & {
  /** Đầu thread: không chân `FlowRecent`/`FlowFooter`. */
  inThread?: boolean;
  /** Timeline: mở thread (`?flow=`). */
  onReply?: (flowId: string) => void;
};

const ACTION_KEY: Record<BlockAction, string> = {
  review: "process.run.action.review",
  answer: "process.run.action.answer",
  decide: "process.run.action.decide",
};

function Header({
  name,
  procKey,
  startedBy,
}: {
  name: string;
  procKey: string;
  startedBy: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span
        aria-hidden
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground"
      >
        <Workflow className="size-4" />
      </span>
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <span className="font-semibold text-foreground">{name}</span>
        <span className="font-mono text-caption text-muted-foreground">{`!${procKey}`}</span>
        <span aria-hidden className="text-muted-foreground">
          ·
        </span>
        <span className="text-caption text-muted-foreground">{startedBy}</span>
      </span>
    </div>
  );
}

type BodyProps = {
  view: ProcessRunFullView | undefined;
  isError: boolean;
  refetch: () => void;
  openThread?: () => void;
  actions: BlockAction[];
  /** Khối timeline (không `inThread`): hiện `TaskWaitingNote` cho việc của người khác. */
  showWaiting: boolean;
};

function BlockBody({ view, isError, refetch, openThread, actions, showWaiting }: BodyProps) {
  const { t } = useTranslation();
  if (isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t("process.thread.stale")}{" "}
        <button type="button" className="underline" onClick={refetch}>
          {t("process.common.error.retry")}
        </button>
      </p>
    );
  }
  if (!view) return <Skeleton aria-busy="true" className="h-5 w-2/3" />;
  const waiting = showWaiting ? waitingOpenTasks(view) : [];
  const autofix = latestAutofix(view);
  return (
    <>
      <StatusLine view={view} />
      <StageStrip stages={stageItems(view)} back={backTrail(view)} />
      {autofix && <AutofixSummary view={autofix} onView={openThread} runId={view.id} />}
      {actions.length > 0 && openThread && (
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <Button key={a} type="button" size="sm" variant="outline" onClick={openThread}>
              {t(ACTION_KEY[a])}
            </Button>
          ))}
        </div>
      )}
      {waiting.map((o) => (
        <TaskWaitingNote key={o.id} open={o} />
      ))}
      <p className="text-caption text-muted-foreground">
        {t("process.run.runsAs", { name: view.started_by.display_name })}
      </p>
    </>
  );
}

function BlockFooter({
  flow,
  openThread,
}: {
  flow: ProcessBlockProps["message"]["flow"];
  openThread?: () => void;
}) {
  const { i18n } = useTranslation();
  // Như AgentBlock: "Trả lời tiếp" luôn hiện (bật khi có `flow_id`); FlowRecent chỉ khi flow có tin gần nhất.
  return (
    <>
      {flow && <FlowRecent flow={flow} onOpen={openThread} />}
      <FlowFooter
        copyValue=""
        hideCopy
        messageCount={flow?.message_count ?? 0}
        timeLabel={flow ? relativeTime(flow.last_active_at, Date.now(), i18n.language) : null}
        openHere={false}
        busy={false}
        onReply={openThread}
      />
    </>
  );
}

function ProcessBlockImpl({ message, part, myId, inThread = false, onReply }: ProcessBlockProps) {
  const { t } = useTranslation();
  const runId = part.process_run_id;
  const q = useThreadRun(runId, null, true);
  const view = q.view?.access === "full" ? (q.view as ProcessRunFullView) : undefined;
  const name = part.process.name;
  const startedBy = view
    ? view.started_by.id === myId
      ? t("process.thread.block.startedByMe")
      : t("process.thread.block.startedBy", { name: view.started_by.display_name })
    : "";
  const flowId = message.flow_id;
  const openThread = flowId && onReply ? () => onReply(flowId) : undefined;
  const actions = view && !inThread ? myActions(view) : [];
  const flow = message.flow;
  return (
    <article
      aria-label={t("process.run.card.aria", { name })}
      data-seq={message.seq}
      data-flow-id={flowId}
      data-run-id={runId}
      className="my-2 flex flex-col gap-3 rounded-[14px] border border-border bg-card p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <Header name={name} procKey={part.process.key} startedBy={startedBy} />
        {view && <RunStatusBadge status={view.status} />}
      </div>
      <BlockBody
        view={view}
        isError={q.isError}
        refetch={() => void q.refetch()}
        openThread={inThread ? undefined : openThread}
        actions={actions}
        showWaiting={!inThread}
      />
      {!inThread && <BlockFooter flow={flow} openThread={openThread} />}
    </article>
  );
}

export const ProcessBlock = memo(ProcessBlockImpl);
