// HUB-FR-101 · X2b plan-frontend D7, D8, §3: run đang chạy/chờ của phòng (`detail.active_runs` + sự kiện `room.run_*`)
// → khối "đang xử lý" cuối timeline. Chỉ người gửi lượt (`caller.id === me`) mở stream `GET /runs/:id/events`
// (driver C1, `convId = room:<id>`); run hết trong `active_runs` (đã có tin agent / huỷ) → bỏ khỏi store.
import type { RoomActiveRun, RoomMessage } from "@ai/contracts/chat";
import { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { cancelRun } from "~/features/run/api";
import { isTerminal } from "~/features/run/lib/reducer";
import { runStore, useRuns } from "~/features/run/run-store";
import { runDriver } from "~/features/run/runtime";
import { pendingRuns } from "../lib/room-agent";
import type { RoomRun } from "./use-send-room-text";

/** Khoá hội thoại của run phòng trong `run-store` (tách khỏi hội thoại C1). */
export const roomConvId = (roomId: string) => `room:${roomId}`;

/** Người gửi lượt: gắn stream ngay khi POST trả `X-Run-Id` (trước cả `room.run_started`). */
export function attachRoomRun(roomId: string, run: RoomRun): void {
  runDriver.attach({
    convId: roomConvId(roomId),
    runId: run.runId,
    flowId: run.flowId,
    origin: "main",
  });
}

export function useRoomRuns(
  roomId: string,
  activeRuns: readonly RoomActiveRun[] | undefined,
  messages: readonly RoomMessage[],
  myId: string,
): RoomActiveRun[] {
  const pending = useMemo(() => pendingRuns(activeRuns, messages), [activeRuns, messages]);
  // Selector trả chuỗi khoá (primitive) run phòng đã kết thúc cần dọn ⇒ chỉ render lại khi tập này đổi, không theo delta SSE.
  const stale = useRuns((runs) => {
    const conv = roomConvId(roomId);
    const live = new Set(pending.map((r) => r.run_id));
    return runs
      .filter((r) => r.convId === conv && r.runId && !live.has(r.runId) && isTerminal(r.phase))
      .map((r) => r.key)
      .join("\n");
  });

  useEffect(() => {
    for (const r of pending) {
      if (r.caller.id === myId) attachRoomRun(roomId, { runId: r.run_id, flowId: r.flow_id });
    }
  }, [pending, myId, roomId]);

  useEffect(() => {
    if (stale) for (const key of stale.split("\n")) runDriver.drop(key);
  }, [stale]);

  return pending;
}

/** "Dừng" của người gửi lượt: qua driver nếu tab đang theo dõi run, không thì gọi thẳng E15. */
export function useStopRoomRun(): (runId: string) => void {
  const { t } = useTranslation();
  return useCallback(
    (runId: string) => {
      const tracked = runStore.getRuns().find((r) => r.runId === runId);
      if (tracked) {
        void runDriver.cancel(tracked.key);
        return;
      }
      cancelRun(runId).catch(() => toast.error(t("roomAgent.toast.stopFailed")));
    },
    [t],
  );
}
