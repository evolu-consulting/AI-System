// CHAT-AC-19, CHAT-AC-21 · `nav "Hội thoại"` 260px: logo + "AI Chat · công ty", Hội thoại mới, tìm, danh sách, người dùng.
// CR-050: danh sách = 3 mục thu gọn được — Nhóm (`+` = Nhóm mới) · Users · Hỏi AI.
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import type { Ref } from "react";
import { useTranslation } from "react-i18next";
import { BrandLogo } from "~/components/shared/BrandLogo";
import { Input } from "~/components/ui/input";
import { ConversationList } from "./ConversationList";
import { RoomSections } from "./RoomSections";
import { SidebarGroup } from "./SidebarGroup";
import { UserMenu } from "./UserMenu";

type Props = {
  tenantName: string;
  displayName: string;
  username: string;
  /** Giá trị ô tìm (tức thì) và giá trị đã debounce dùng để gọi API. */
  query: string;
  debouncedQuery: string;
  onQueryChange: (q: string) => void;
  searchRef: Ref<HTMLInputElement>;
  activeId: string | null;
  activeRoomId: string | null;
  /** Mở hộp thoại "Tạo nhóm"; vắng thì nút bị vô hiệu. */
  onNewGroup?: () => void;
  onNavigate?: () => void;
  onOpenSettings: () => void;
};

export function Sidebar(p: Props) {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t("shell.nav")}
      className="flex h-full w-[260px] shrink-0 flex-col gap-3 border-r border-sidebar-border bg-card px-3 py-4"
    >
      <div className="flex flex-col gap-0.5 px-1">
        <BrandLogo
          className="min-h-[62px] items-center"
          imgClassName="-ml-2.5 h-[62px] w-[200px] object-contain object-left"
        />
        <span className="pl-1.5 text-xs text-muted-foreground">
          {t("shell.brand", { tenant: p.tenantName })}
        </span>
      </div>
      <Link
        to="/c/new"
        onClick={p.onNavigate}
        className="flex h-10 items-center gap-2 rounded-lg border border-input bg-card px-3 text-sm font-semibold whitespace-nowrap outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus className="size-[18px] shrink-0" aria-hidden />
        <span className="truncate">{t("shell.newChat")}</span>
      </Link>
      <Input
        ref={p.searchRef}
        type="search"
        aria-label={t("shell.search")}
        placeholder={t("shell.search")}
        value={p.query}
        onChange={(e) => p.onQueryChange(e.target.value)}
        className="h-9 bg-muted"
      />
      <div className="relative -mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        <RoomSections
          q={p.debouncedQuery}
          activeRoomId={p.activeRoomId}
          onNavigate={p.onNavigate}
          onNewGroup={p.onNewGroup}
        />
        <div className="mt-1">
          <SidebarGroup id="ai" title={t("rooms.sectionAi")}>
            <ConversationList
              q={p.debouncedQuery}
              activeId={p.activeId}
              onNavigate={p.onNavigate}
            />
          </SidebarGroup>
        </div>
      </div>
      <UserMenu
        displayName={p.displayName}
        username={p.username}
        onOpenSettings={p.onOpenSettings}
      />
    </nav>
  );
}
