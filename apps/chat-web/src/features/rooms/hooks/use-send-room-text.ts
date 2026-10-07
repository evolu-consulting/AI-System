// HUB-FR-96, HUB-FR-100 · gửi tin của composer phòng. `client_msg_id` sinh một lần cho mỗi lần gõ gửi,
// giữ nguyên khi bấm Gửi lại cùng nội dung (idempotent R15). Không optimistic: chèn cache sau khi POST xong (plan-frontend D7).
import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useSendRoomMessage } from "./use-room-actions";

export function useSendRoomText(roomId: string, onSent: () => void) {
  const { t } = useTranslation();
  const send = useSendRoomMessage(roomId);
  const pending = useRef<{ text: string; id: string } | null>(null);
  const mutate = send.mutateAsync;
  return useCallback(
    async (text: string): Promise<boolean> => {
      const cur = pending.current;
      const id = cur && cur.text === text ? cur.id : crypto.randomUUID();
      pending.current = { text, id };
      try {
        await mutate({ content: text, client_msg_id: id });
        pending.current = null;
        onSent();
        return true;
      } catch {
        toast.error(t("rooms.toast.sendFailed"));
        return false;
      }
    },
    [mutate, onSent, t],
  );
}
