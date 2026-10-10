// CR-056 · P-a thread §2/§6 #6: thread `?flow=` thuộc loại nào — `process` (khối quy trình) hay `agent` (X2b)?
// Ưu tiên khối gốc có sẵn trong cache timeline; chưa có thì suy từ tin đầu của thread (cùng khoá cache với `RoomFlowContent`, không fetch thêm).
import { useQueryClient } from "@tanstack/react-query";
import { type RoomMessagesData, roomKeys } from "../lib/room-cache";
import { useFlowMessages } from "./use-room-flow";

export type FlowKind = "loading" | "process" | "agent";

const noop = () => {};

export function useFlowKind(roomId: string, flowId: string): FlowKind {
  const qc = useQueryClient();
  const timeline = qc.getQueryData<RoomMessagesData>(roomKeys.messages(roomId));
  const root = timeline?.pages
    .flatMap((p) => p.items)
    .find((m) => m.flow_id === flowId && (m.placement ?? "main") === "main");
  const flow = useFlowMessages(roomId, flowId, noop, root === undefined);
  const first = root ?? flow.messages[0];
  if (!first) return flow.isError ? "agent" : "loading";
  return first.sender_type === "process" ? "process" : "agent";
}
