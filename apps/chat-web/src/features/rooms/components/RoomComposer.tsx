// HUB-FR-96 · composer phòng: `Composer` variant "room" (không menu `@`/`/`, không đính kèm; Q3, §5.3), nháp theo phòng.
import { CHAT_CONTENT_MAX } from "@ai/contracts/chat";
import { useTranslation } from "react-i18next";
import { Composer } from "~/features/composer/components/Composer";
import { useDraftKey } from "~/features/composer/hooks/use-draft";
import { useSendRoomText } from "../hooks/use-send-room-text";

type Props = { roomId: string; target: string; group: boolean; onSent(): void };

export function RoomComposer({ roomId, target, group, onSent }: Props) {
  const { t } = useTranslation();
  const draftKey = useDraftKey(roomId, null);
  const send = useSendRoomText(roomId, onSent);
  return (
    <div className="mx-auto w-full max-w-[800px] px-4 pb-5 sm:px-6">
      <Composer
        variant="room"
        draftKey={draftKey}
        menus={false}
        attachments={false}
        maxChars={CHAT_CONTENT_MAX}
        inputLabel={t(group ? "rooms.composer.group" : "rooms.composer.dm", { name: target })}
        onSubmit={send}
      />
    </div>
  );
}
