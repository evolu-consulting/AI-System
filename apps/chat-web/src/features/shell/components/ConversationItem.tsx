// CHAT-AC-20, CHAT-AC-21, CHAT-AC-22 · một dòng hội thoại: link + menu `⋯` (Đổi tên / Xoá).
import type { Conversation } from "@ai/contracts/chat";
import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { cn } from "~/lib/utils";
import { conversationPath } from "../lib/conversation-path";
import { DeleteDialog } from "./DeleteDialog";
import { RenameDialog } from "./RenameDialog";

type Props = {
  conversation: Conversation;
  active: boolean;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => void;
};

export function ConversationItem({ conversation, active, onOpen, onRename, onDelete }: Props) {
  const { t } = useTranslation();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { id, title } = conversation;

  return (
    <li className="group relative">
      <a
        href={conversationPath(id)}
        aria-current={active ? "page" : undefined}
        title={title}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          onOpen(id);
        }}
        className={cn(
          "block truncate rounded-lg py-2 pr-9 pl-2.5 text-sm text-sidebar-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
          active && "bg-sidebar-accent font-semibold text-sidebar-accent-foreground",
        )}
      >
        {title}
      </a>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("item.more")}
            className="absolute top-1/2 right-1 size-7 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100"
          >
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setRenaming(true)}>{t("item.rename")}</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
            {t("item.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <RenameDialog
        open={renaming}
        onOpenChange={setRenaming}
        title={title}
        onSave={(next) => onRename(id, next)}
      />
      <DeleteDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={title}
        onConfirm={() => onDelete(id)}
      />
    </li>
  );
}
