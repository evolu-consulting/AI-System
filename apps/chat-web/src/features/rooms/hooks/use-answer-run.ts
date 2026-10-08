// HUB-FR-101 · X2b D13, §4 (chờ): người gửi lượt trả lời `need_input` / xác nhận `side_effect` — gửi trong thread kèm
// `{flow_id, answer_run_id}` (thiếu `answer_run_id` server coi là tin thường). 403 `NOT_RUN_CALLER` → toast + làm tươi;
// 404 `NOT_FOUND` (run hết chờ / thread lạ) → toast + làm tươi. "Chạy lại" (lỗi/huỷ) gửi lại nguyên văn tin gọi.
import type { RoomDetail, RoomMessage, SendRoomMessageRequest } from "@ai/contracts/chat";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ApiError } from "~/lib/http";
import { type SentRoomMessage, sendRoomMessage } from "../api";
import { isMainPlacement, removeActiveRun } from "../lib/room-agent";
import { insertMessage, type RoomMessagesData, roomKeys } from "../lib/room-cache";
import { attachRoomRun } from "./use-room-runs";

function refresh(qc: QueryClient, roomId: string) {
  void qc.invalidateQueries({ queryKey: roomKeys.detail(roomId) });
  void qc.invalidateQueries({ queryKey: roomKeys.messages(roomId) });
}

function sendBody(content: string, flowId?: string, answerRunId?: string): SendRoomMessageRequest {
  const body: SendRoomMessageRequest = { content, client_msg_id: crypto.randomUUID() };
  if (flowId) body.flow_id = flowId;
  if (flowId && answerRunId) body.answer_run_id = answerRunId;
  return body;
}

/** Vá cache sau 201/200: tin chính vào timeline (tin thread: đếm khối gốc tăng qua `room.message`, tránh đếm hai lần);
 * lượt đã trả lời rời `active_runs`; run mới → người gửi gắn stream (D8). */
function applySent(qc: QueryClient, roomId: string, r: SentRoomMessage, answerRunId?: string) {
  const msg = r.message;
  if (isMainPlacement(msg)) {
    qc.setQueryData<RoomMessagesData>(roomKeys.messages(roomId), (d) => insertMessage(d, msg));
  }
  if (answerRunId) {
    qc.setQueryData<RoomDetail>(roomKeys.detail(roomId), (d) => removeActiveRun(d, answerRunId));
  }
  if (r.runId && r.flowId) attachRoomRun(roomId, { runId: r.runId, flowId: r.flowId });
}

export type RoomTurnActions = {
  /** Bấm chip / "Đồng ý" / "Huỷ" của lượt mình đang chờ. */
  answer(message: RoomMessage, choice: string): Promise<boolean>;
  /** "Chạy lại" lượt lỗi/huỷ của mình: gửi lại nội dung tin gọi (cùng thread nếu tin ở thread). */
  rerun(message: RoomMessage, content: string): Promise<boolean>;
};

export function useRoomTurnActions(roomId: string, onOpenFlow?: (flowId: string) => void) {
  const qc = useQueryClient();
  const { t } = useTranslation();

  const post = useCallback(
    async (content: string, flowId: string | undefined, answerRunId?: string) => {
      try {
        const r = await sendRoomMessage(roomId, sendBody(content, flowId, answerRunId));
        applySent(qc, roomId, r, answerRunId);
        return true;
      } catch (err) {
        const code = err instanceof ApiError ? err.code : undefined;
        toast.error(
          t(code === "NOT_RUN_CALLER" ? "roomAgent.toast.notCaller" : "rooms.toast.sendFailed"),
        );
        if (code === "NOT_RUN_CALLER" || code === "NOT_FOUND") refresh(qc, roomId);
        return false;
      }
    },
    [qc, roomId, t],
  );

  const answer = useCallback(
    async (message: RoomMessage, choice: string) => {
      if (!message.flow_id || !message.run_id) return false;
      const ok = await post(choice, message.flow_id, message.run_id);
      if (ok) onOpenFlow?.(message.flow_id);
      return ok;
    },
    [post, onOpenFlow],
  );

  const rerun = useCallback(
    (message: RoomMessage, content: string) =>
      post(content, message.placement === "flow" ? message.flow_id : undefined),
    [post],
  );

  return { answer, rerun } satisfies RoomTurnActions;
}

/** "Chạy lại" từ khối agent: tìm tin gọi (`trigger_message_id`) trong danh sách đang hiện; ref giữ callback ổn định (memo). */
export function useRerunFromList(
  messages: readonly RoomMessage[],
  rerun: RoomTurnActions["rerun"],
): (message: RoomMessage) => void {
  const ref = useRef(messages);
  ref.current = messages;
  return useCallback(
    (m: RoomMessage) => {
      const trigger = ref.current.find((x) => x.id === m.trigger_message_id);
      if (trigger) void rerun(m, trigger.content);
    },
    [rerun],
  );
}
