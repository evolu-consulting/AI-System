// HUB-FR-101 · nối một run đang chạy của phòng với `PendingAgentBlock` (hook đọc run-store + "Dừng").
import type { RoomActiveRun } from "@ai/contracts/chat";
import { usePendingAgentBlock } from "../../hooks/use-agent-block";
import { PendingAgentBlock } from "./PendingAgentBlock";

export function PendingRunItem({ run, myId }: { run: RoomActiveRun; myId: string }) {
  return <PendingAgentBlock {...usePendingAgentBlock(run, myId)} />;
}
