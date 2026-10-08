// HUB-FR-96, HUB-FR-103 · composer phòng: `Composer` variant "room" với menu `@` (không `/`, Q10), không đính kèm (F5/X2b-2), nháp theo phòng.
import { CHAT_CONTENT_MAX } from "@ai/contracts/chat";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Composer } from "~/features/composer/components/Composer";
import { useDraftKey } from "~/features/composer/hooks/use-draft";
import { attachRoomRun } from "../hooks/use-room-runs";
import { type RoomRun, useSendRoomText } from "../hooks/use-send-room-text";

type Props = { roomId: string; target: string; group: boolean; onSent(): void };

export function RoomComposer({ roomId, target, group, onSent }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const draftKey = useDraftKey(roomId, null);
  // D8: người gửi lượt mở stream ngay khi POST trả `X-Run-Id`.
  const onRun = useCallback((run: RoomRun) => attachRoomRun(roomId, run), [roomId]);
  const send = useSendRoomText(roomId, onSent, onRun);
  // Mở phòng: làm tươi menu `@` một lần (agent bị thu hồi biến mất, AC13).
  // biome-ignore lint/correctness/useExhaustiveDependencies: chạy lại theo roomId
  useEffect(() => {
    void qc.invalidateQueries({ queryKey: ["agents", "menu"] });
  }, [qc, roomId]);
  return (
    <div className="mx-auto w-full max-w-[800px] px-4 pb-5 sm:px-6">
      <Composer
        variant="room"
        draftKey={draftKey}
        menus="agents"
        attachments={false}
        maxChars={CHAT_CONTENT_MAX}
        inputLabel={t(group ? "rooms.composer.group" : "rooms.composer.dm", { name: target })}
        placeholder={t(group ? "roomAgent.placeholder.group" : "roomAgent.placeholder.dm", {
          name: target,
        })}
        menuTitle={t("menu.agentsYours")}
        hint={t("roomAgent.hint")}
        onSubmit={send}
      />
    </div>
  );
}
