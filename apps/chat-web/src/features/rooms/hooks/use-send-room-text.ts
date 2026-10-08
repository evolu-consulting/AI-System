// HUB-FR-96, HUB-FR-100, HUB-FR-103 · gửi tin của composer phòng. `client_msg_id` sinh một lần cho mỗi lần gõ gửi,
// giữ nguyên khi bấm Gửi lại cùng nội dung (idempotent R15). Không optimistic: chèn cache sau khi POST xong (plan-frontend D7).
// Trả `SubmitResult` (D5): lỗi composer (`AGENT_NOT_FOUND`, `TOO_MANY_RUNS`…) hiện trong ô, giữ nội dung; mã khác → toast.
import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { SubmitResult } from "~/features/composer/hooks/use-send-error";
import { isComposerError } from "~/features/composer/lib/send-error";
import { ApiError } from "~/lib/http";
import { useSendRoomMessage } from "./use-room-actions";

export type RoomRun = { runId: string; flowId: string };

export function useSendRoomText(
  roomId: string,
  onSent: () => void,
  onRun?: (run: RoomRun) => void,
) {
  const { t } = useTranslation();
  const send = useSendRoomMessage(roomId);
  const pending = useRef<{ text: string; id: string } | null>(null);
  const mutate = send.mutateAsync;
  return useCallback(
    async (text: string): Promise<SubmitResult> => {
      const cur = pending.current;
      const id = cur && cur.text === text ? cur.id : crypto.randomUUID();
      pending.current = { text, id };
      try {
        const r = await mutate({ content: text, client_msg_id: id });
        pending.current = null;
        if (r.runId && r.flowId) onRun?.({ runId: r.runId, flowId: r.flowId });
        onSent();
        return true;
      } catch (err) {
        if (err instanceof ApiError && isComposerError(err)) return { ok: false, error: err };
        toast.error(t("rooms.toast.sendFailed"));
        return false;
      }
    },
    [mutate, onSent, onRun, t],
  );
}
