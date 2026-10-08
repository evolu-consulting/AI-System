// HUB-FR-101, HUB-FR-103 · X2b D10, D13, §2: thread chung của phòng (`?flow=`). Tin = `GET /rooms/:id/messages?flow_id=`
// (gồm tin gốc, sự kiện `room.message` vá thêm); flow lạ/khác phòng (404) → bỏ `?flow` (replace), không báo lỗi.
// Gửi: MỌI thành viên `{content, flow_id}`; không tag = tin người↔người; tag `@agent` = run mới bằng quyền người tag;
// lượt của mình đang chờ + tin không tag ⇒ kèm `answer_run_id`. `AGENT_NOT_FOUND`… giữ chữ trong ô; `FLOW_BUSY` → toast.
import type { RoomActiveRun, RoomDetail, SendRoomMessageRequest } from "@ai/contracts/chat";
import { type QueryClient, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { leadingTag } from "~/features/agents/lib/mention";
import type { SubmitResult } from "~/features/composer/hooks/use-send-error";
import { isComposerError } from "~/features/composer/lib/send-error";
import { ApiError } from "~/lib/http";
import { listFlowMessages, type SentRoomMessage, sendRoomMessage } from "../api";
import { ownWaitingRunId, removeActiveRun } from "../lib/room-agent";
import { insertMessage, type RoomMessagesData, roomKeys } from "../lib/room-cache";
import { attachRoomRun } from "./use-room-runs";

export function useFlowMessages(roomId: string, flowId: string, onUnknown: () => void) {
  const query = useInfiniteQuery({
    queryKey: roomKeys.flow(roomId, flowId),
    queryFn: ({ pageParam, signal }) => listFlowMessages(roomId, flowId, pageParam, signal),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (first) => {
      const seq = first.items[0]?.seq;
      return first.has_more && seq !== undefined ? seq : undefined;
    },
    retry: false,
  });
  const unknown = query.error instanceof ApiError && query.error.status === 404;
  useEffect(() => {
    if (unknown) onUnknown();
  }, [unknown, onUnknown]);
  const messages = [...(query.data?.pages ?? [])].reverse().flatMap((p) => p.items);
  return { ...query, messages, unknown };
}

type FlowRef = { roomId: string; flowId: string };

function applyFlowSent(
  qc: QueryClient,
  { roomId, flowId }: FlowRef,
  r: SentRoomMessage,
  answerRunId?: string,
) {
  qc.setQueryData<RoomMessagesData>(roomKeys.flow(roomId, flowId), (d) =>
    insertMessage(d, r.message),
  );
  if (answerRunId) {
    qc.setQueryData<RoomDetail>(roomKeys.detail(roomId), (d) => removeActiveRun(d, answerRunId));
  }
  if (r.runId && r.flowId) attachRoomRun(roomId, { runId: r.runId, flowId: r.flowId });
}

type SendArgs = {
  roomId: string;
  flowId: string;
  myId: string;
  activeRuns: readonly RoomActiveRun[] | undefined;
};

/** `onSubmit` của composer thread (D13). `client_msg_id` giữ nguyên khi gửi lại cùng chữ (idempotent). */
export function useFlowSend({ roomId, flowId, myId, activeRuns }: SendArgs) {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const pending = useRef<{ text: string; id: string } | null>(null);
  const runsRef = useRef(activeRuns);
  runsRef.current = activeRuns;

  const fail = useCallback(
    (err: unknown): SubmitResult => {
      const code = err instanceof ApiError ? err.code : undefined;
      if (code === "AGENT_NOT_FOUND") void qc.invalidateQueries({ queryKey: ["agents", "menu"] });
      if (err instanceof ApiError && isComposerError(err)) return { ok: false, error: err };
      if (code === "NOT_FOUND" || code === "NOT_RUN_CALLER") {
        void qc.invalidateQueries({ queryKey: roomKeys.detail(roomId) });
      }
      const key =
        code === "FLOW_BUSY"
          ? "roomAgent.flowBusy"
          : code === "NOT_RUN_CALLER"
            ? "roomAgent.toast.notCaller"
            : "rooms.toast.sendFailed";
      toast.error(t(key));
      return false;
    },
    [qc, roomId, t],
  );

  return useCallback(
    async (text: string): Promise<SubmitResult> => {
      const cur = pending.current;
      const id = cur && cur.text === text ? cur.id : crypto.randomUUID();
      pending.current = { text, id };
      const answerRunId =
        leadingTag(text) === null ? ownWaitingRunId(runsRef.current, flowId, myId) : undefined;
      const body: SendRoomMessageRequest = { content: text, client_msg_id: id, flow_id: flowId };
      if (answerRunId) body.answer_run_id = answerRunId;
      try {
        const r = await sendRoomMessage(roomId, body);
        pending.current = null;
        applyFlowSent(qc, { roomId, flowId }, r, answerRunId);
        return true;
      } catch (err) {
        return fail(err);
      }
    },
    [qc, roomId, flowId, myId, fail],
  );
}

function focusReply(flowId: string): void {
  requestAnimationFrame(() => {
    const sel = `article[data-flow-id="${CSS.escape(flowId)}"] [data-flow-reply]`;
    document.querySelector<HTMLElement>(sel)?.focus();
  });
}

/** Điều hướng `?flow=` (§2): mở; đóng (✕/Esc/kéo) → xoá `flow`, focus lại "Trả lời tiếp"; flow lạ → bỏ (replace). */
export function useRoomFlowNav(roomId: string, openFlowId: string | undefined) {
  const navigate = useNavigate();
  const go = useCallback(
    (flow: string | undefined, replace = false) =>
      void navigate({
        to: "/rooms/$id",
        params: { id: roomId },
        search: flow ? { flow } : {},
        replace,
      }),
    [navigate, roomId],
  );
  const open = useCallback((flow: string) => go(flow), [go]);
  const close = useCallback(() => {
    go(undefined);
    if (openFlowId) focusReply(openFlowId);
  }, [go, openFlowId]);
  const drop = useCallback(() => go(undefined, true), [go]);
  return { open, close, drop };
}
