// CR-050 · khung thread đang mở ∧ tab hiện ⇒ đã xem thread tới seq lớn nhất đang hiển thị (POST /rooms/:id/flows/:fid/read,
// throttle như `useMarkRead`); kết quả vá khối gốc ở timeline: `flow.unread` + bỏ highlight `flow.recent` ≤ mốc.
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { markRoomFlowRead } from "../api";
import { createMarkReadGate, type MarkReadGate } from "../lib/mark-read-gate";
import { markFlowSeen } from "../lib/room-agent";
import { type RoomMessagesData, roomKeys } from "../lib/room-cache";
import { useTabVisible } from "./use-mark-read";

const INTERVAL_MS = 1000;

export function useMarkFlowRead(roomId: string, flowId: string, lastSeq: number): void {
  const qc = useQueryClient();
  const visible = useTabVisible();
  const gate = useRef<MarkReadGate | null>(null);

  useEffect(() => {
    const g = createMarkReadGate({
      send: async (seq) => {
        const r = await markRoomFlowRead(roomId, flowId, seq);
        qc.setQueryData<RoomMessagesData>(roomKeys.messages(roomId), (d) =>
          markFlowSeen(d, flowId, seq, r.unread),
        );
      },
      now: () => Date.now(),
      setTimer: (cb, ms) => {
        const t = setTimeout(cb, ms);
        return () => clearTimeout(t);
      },
      intervalMs: INTERVAL_MS,
    });
    gate.current = g;
    return () => {
      g.dispose();
      gate.current = null;
    };
  }, [qc, roomId, flowId]);

  useEffect(() => {
    if (visible && lastSeq > 0) gate.current?.offer(lastSeq);
  }, [visible, lastSeq]);
}
