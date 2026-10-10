// CHAT-AC-56 · PF3 (full view): link "‹ Quay lại {{phòng}}" → `/rooms/$id`, chỉ khi thấy phòng (query 200). Mounted
// riêng ⇒ `useRoom` chỉ chạy cho origin phòng.

import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRoom } from "~/features/rooms/hooks/use-room";

export function RoomBackLink({ roomId }: { roomId: string }) {
  const { t } = useTranslation();
  const room = useRoom(roomId);
  if (!room.data?.name) return null;
  return (
    <Link
      to="/rooms/$id"
      params={{ id: roomId }}
      className="inline-flex items-center gap-1 text-caption font-medium text-muted-foreground hover:text-foreground"
    >
      <ChevronLeft className="size-3.5" aria-hidden />
      {t("process.inbox.run.back.room", { name: room.data.name })}
    </Link>
  );
}
