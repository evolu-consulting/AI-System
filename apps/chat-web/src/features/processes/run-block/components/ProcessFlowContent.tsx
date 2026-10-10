// CHAT-AC-52/53 · plan-frontend-thread §1/§4: nội dung pane thread quy trình — header, thanh trạng thái, danh sách tin, composer thread.
// `RoomFlowPane` rẽ vào đây khi `useFlowKind() === "process"`; nhận cùng props với `RoomFlowContent` + slot của `FlowFrame`.
import type { ProcessRunFullView } from "@ai/contracts/chat";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import type { FlowFrameSlot } from "~/features/flow-panel/components/FlowFrame";
import { FlowHeader } from "~/features/flow-panel/components/FlowHeader";
import type { RoomFlowProps } from "~/features/rooms/components/flow/RoomFlowContent";
import { useFlowMessages } from "~/features/rooms/hooks/use-room-flow";
import { RunStatusBadge } from "../../shared/components/RunStatusBadge";
import { StageStrip } from "../../shared/components/StageStrip";
import { useProcessRun } from "../../shared/hooks/use-process-run";
import { threadTitle } from "../../shared/lib/thread-task";
import { currentStage, stageItems } from "../lib/block-view";
import { CancelRunButton } from "./CancelRunButton";
import { ProcessFlowMessages } from "./ProcessFlowMessages";
import { ProcessThreadFooter } from "./ProcessThreadFooter";
import { StatusLine } from "./StatusLine";

export type ProcessFlowContentProps = RoomFlowProps & FlowFrameSlot;

function StatusBar({
  runId,
  view,
  onCancelled,
}: {
  runId: string;
  view: ProcessRunFullView;
  onCancelled: () => void;
}) {
  const { t } = useTranslation();
  const cur = currentStage(view);
  return (
    <div className="flex flex-col gap-2 border-b border-border bg-muted/40 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <RunStatusBadge status={view.status} />
        {cur && cur.attempt_limit > 1 && (
          <span className="text-caption text-muted-foreground">
            {t("process.thread.chip.rework", { a: cur.attempt, max: cur.attempt_limit })}
          </span>
        )}
        {cur && cur.ask_limit > 0 && (
          <span className="text-caption text-muted-foreground">
            {t("process.thread.chip.asks", { n: cur.asks_count, max: cur.ask_limit })}
          </span>
        )}
        <span className="grow" />
        {view.status !== "needs_decision" && (
          <CancelRunButton runId={runId} canCancel={view.can_cancel} onCancelled={onCancelled} />
        )}
      </div>
      <StatusLine view={view} className="text-caption text-secondary-foreground" />
      <StageStrip stages={stageItems(view)} />
      <div className="flex flex-wrap items-center justify-between gap-2 text-caption text-muted-foreground">
        <span>{t("process.run.runsAs", { name: view.started_by.display_name })}</span>
        <Link to="/runs/$id" params={{ id: runId }} className="text-primary-strong hover:underline">
          {t("process.run.pane.openPage")}
        </Link>
      </div>
    </div>
  );
}

export function ProcessFlowContent(p: ProcessFlowContentProps) {
  const { t } = useTranslation();
  const msgs = useFlowMessages(p.roomId, p.flowId, p.onUnknown);
  const { messages } = msgs;
  const root = messages.find((m) => m.process?.kind === "block");
  const runId = root?.process_run_id;
  const title = root ? threadTitle(root) : t("flow.panel");
  const count = root?.flow?.message_count ?? messages.length;
  const run = useProcessRun(runId);
  const view = run.data?.access === "full" ? (run.data as ProcessRunFullView) : undefined;
  const failed = msgs.isError && !msgs.unknown;
  return (
    <>
      <FlowHeader title={title} count={count} mobile={p.mobile} onClose={p.onClose} />
      {run.isError ? (
        <p role="alert" className="flex items-center gap-2 px-4 py-3 text-caption text-destructive">
          {t("process.thread.stale")}
          <button type="button" className="underline" onClick={() => void run.refetch()}>
            {t("process.common.error.retry")}
          </button>
        </p>
      ) : (
        view && runId && <StatusBar runId={runId} view={view} onCancelled={p.onClose} />
      )}
      {failed ? (
        <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-2 p-6">
          <span>{t("roomAgent.flowLoadError")}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void msgs.refetch()}>
            {t("roomAgent.flowRetry")}
          </Button>
        </div>
      ) : (
        <ProcessFlowMessages
          roomId={p.roomId}
          myId={p.myId}
          messages={messages}
          loading={msgs.isPending}
          hasOlder={msgs.hasNextPage}
          loadOlder={() => {
            if (msgs.hasNextPage && !msgs.isFetchingNextPage) void msgs.fetchNextPage();
          }}
        />
      )}
      <div className="shrink-0 border-t border-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <ProcessThreadFooter
          roomId={p.roomId}
          flowId={p.flowId}
          myId={p.myId}
          activeRuns={p.activeRuns}
          composerRef={p.composerRef}
          mobile={p.mobile}
        />
      </div>
    </>
  );
}
