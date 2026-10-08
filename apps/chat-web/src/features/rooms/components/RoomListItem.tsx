// HUB-FR-96, HUB-FR-100 · một dòng phòng ở sidebar: avatar chữ cái, tên, xem trước, huy hiệu chưa đọc.
// Tên accessible = chỉ tên phòng; xem trước + "n tin chưa đọc" nằm ở `aria-describedby` (plan-frontend-e2e §1).
// CR-050: `menu` = nút `⋯` (Đổi tên / Rời / Xoá / Ẩn) đè lên góc phải khi rê chuột, như dòng hội thoại AI.
import type { RoomSummary } from "@ai/contracts/chat";
import { type ReactNode, useId } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/utils";
import { initialsOf } from "../../shell/lib/conversation-path";
import { previewOf, roomTitle } from "../lib/room-logic";

type Props = {
  room: RoomSummary;
  myId: string;
  active: boolean;
  onOpen: (id: string) => void;
  menu?: ReactNode;
};

export function RoomListItem({ room, myId, active, onOpen, menu }: Props) {
  const { t } = useTranslation();
  const uid = useId();
  const title = roomTitle(room);
  const pv = previewOf(room, myId);
  const preview = pv ? t(`rooms.preview.${pv.who}`, { name: pv.name, text: pv.text }) : "";
  const unreadText = room.unread > 0 ? t("rooms.unreadBadge", { count: room.unread }) : "";
  return (
    <li className="group relative">
      <a
        href={`/rooms/${encodeURIComponent(room.id)}`}
        data-room-id={room.id}
        aria-current={active ? "page" : undefined}
        aria-labelledby={`${uid}-t`}
        aria-describedby={`${uid}-d`}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          onOpen(room.id);
        }}
        className={cn(
          "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sidebar-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
          active && "bg-sidebar-accent text-sidebar-accent-foreground",
        )}
      >
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground"
        >
          {initialsOf(title)}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            id={`${uid}-t`}
            className={cn("truncate text-sm", room.unread > 0 ? "font-semibold" : "font-medium")}
          >
            {title}
          </span>
          <span id={`${uid}-d`} className="truncate text-xs text-muted-foreground">
            {preview}
            <span className="sr-only">{unreadText}</span>
          </span>
        </span>
        {room.unread > 0 && (
          <span
            data-testid="unread-badge"
            aria-hidden
            className="min-w-5 shrink-0 rounded-full bg-primary px-1.5 text-center text-[11px] leading-5 font-semibold text-primary-foreground"
          >
            {room.unread}
          </span>
        )}
      </a>
      {menu}
    </li>
  );
}
