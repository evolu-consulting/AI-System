// HUB-FR-100 · "Đã xem" dưới tin cuối của mình (Q5): DM "Đã xem"; nhóm "Đã xem bởi n" + tên người xem ở `title`.
import type { RoomMember } from "@ai/contracts/chat";
import { useTranslation } from "react-i18next";
import { readerNames } from "../../lib/room-logic";

type Props = { readers: RoomMember[]; group: boolean };

export function SeenMark({ readers, group }: Props) {
  const { t } = useTranslation();
  if (readers.length === 0) return null;
  const { names, more } = readerNames(readers);
  const title = group
    ? [names.join(", "), more > 0 ? t("rooms.seenMore", { count: more }) : ""]
        .filter(Boolean)
        .join(" ")
    : undefined;
  return (
    <div
      role="status"
      title={title}
      className="mt-0.5 text-right text-caption text-muted-foreground"
    >
      {group ? t("rooms.seenBy", { count: readers.length }) : t("rooms.seen")}
    </div>
  );
}
