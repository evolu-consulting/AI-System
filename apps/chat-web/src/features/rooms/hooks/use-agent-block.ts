// HUB-FR-101 · X2b D8, D9: run đang chạy/chờ của phòng + run-store (stream của người gửi lượt) → props `PendingAgentBlock`.
import type { RoomActiveRun } from "@ai/contracts/chat";
import { useTranslation } from "react-i18next";
import { useRuns } from "~/features/run/run-store";
import { answerFromRun } from "~/features/thread/lib/thread-logic";
import type { PendingAgentBlockProps } from "../components/agent/PendingAgentBlock";
import { agentName } from "../lib/room-agent";
import { useStopRoomRun } from "./use-room-runs";

export function usePendingAgentBlock(run: RoomActiveRun, myId: string): PendingAgentBlockProps {
  const { t, i18n } = useTranslation();
  const mine = run.caller.id === myId;
  const stop = useStopRoomRun();
  const tracked = useRuns((runs) => (mine ? runs.find((r) => r.runId === run.run_id) : undefined));
  return {
    runId: run.run_id,
    flowId: run.flow_id,
    name: agentName(run.agent, i18n.language, t("roomAgent.orchestratorName")),
    agentKey: run.agent?.key,
    callerName: run.caller.display_name,
    mine,
    answer: tracked ? answerFromRun(tracked) : null,
    stopping: tracked?.cancelling ?? false,
    onStop: () => stop(run.run_id),
  };
}
