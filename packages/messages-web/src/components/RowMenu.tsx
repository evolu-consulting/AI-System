// CR-190 · «⋯» trên dòng danh sách: Ghim/Bỏ ghim, Đánh dấu chưa đọc/đã đọc. Máy tính: nút hiện khi rê chuột/focus dòng. Điện thoại/máy cảm ứng: giữ lâu mở menu.
import type { ConversationSummary } from "@ai/contracts/pack-contracts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ai/web-kit/ui/kit/dropdown-menu";
import { type PointerEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconMore } from "../icons";
import { markIsRead } from "../lib/dir-rows";

export type RowMenuHandlers = {
  onPin: (id: string, pinned: boolean) => void;
  onMarkUnread: (id: string) => void;
  onMarkRead: (c: ConversationSummary) => void;
};

const LONG_PRESS_MS = 500;

/** Giữ lâu (chỉ cảm ứng) ⇒ mở menu; thả tay sau đó KHÔNG được tính là bấm mở cuộc. */
export function useRowMenu(enabled: boolean) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const press = enabled
    ? {
        onPointerDown: (e: PointerEvent) => {
          if (e.pointerType !== "touch") return;
          fired.current = false;
          cancel();
          timer.current = setTimeout(() => {
            fired.current = true;
            setOpen(true);
          }, LONG_PRESS_MS);
        },
        onPointerUp: cancel,
        onPointerLeave: cancel,
        onPointerCancel: cancel,
        onPointerMove: cancel,
        onContextMenu: (e: { preventDefault: () => void }) => {
          if (fired.current) e.preventDefault();
        },
      }
    : {};
  return {
    open,
    setOpen,
    press,
    /** Bấm ngay sau khi giữ lâu ⇒ nuốt (một lần). */
    swallowClick: (): boolean => {
      const was = fired.current;
      fired.current = false;
      return was;
    },
  };
}

export function RowMenu({
  c,
  handlers,
  open,
  onOpenChange,
  label,
}: {
  c: ConversationSummary;
  handlers: RowMenuHandlers;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  label: string;
}) {
  const { t } = useTranslation();
  const pinned = Boolean(c.pinned_at);
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          data-testid="conv-more"
          className="absolute right-2 top-2 grid size-7 place-items-center rounded-md bg-panel/90 text-dim opacity-0 hover:bg-sunk hover:text-ink focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:pointer-events-none"
        >
          <IconMore width={16} height={16} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" data-testid="conv-menu">
        <DropdownMenuItem
          data-testid="conv-pin-toggle"
          onSelect={() => handlers.onPin(c.id, !pinned)}
        >
          {pinned ? t("contracts.messages.unpin") : t("contracts.messages.pin")}
        </DropdownMenuItem>
        {markIsRead(c) ? (
          <DropdownMenuItem data-testid="conv-mark-read" onSelect={() => handlers.onMarkRead(c)}>
            {t("contracts.messages.markRead")}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            data-testid="conv-mark-unread"
            onSelect={() => handlers.onMarkUnread(c.id)}
          >
            {t("contracts.messages.markUnread")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
