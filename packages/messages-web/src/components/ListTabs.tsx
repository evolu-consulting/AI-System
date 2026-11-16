// CR-178 · thanh lọc danh sách: «Tất cả · Chưa đọc (n) · Đối tác ▾». «Đối tác» mở menu chọn công ty đã kết nối (thay hàng chip công ty).
import type { MsgCompany } from "@ai/contracts/pack-contracts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ai/web-kit/ui/kit/dropdown-menu";
import { useTranslation } from "react-i18next";
import type { ListTab, ListView } from "../lib/list-view";
import { cn } from "../ui";
import { LoadSentinel } from "./LoadSentinel";

export type ListTabsProps = {
  view: ListView;
  onTab: (tab: ListTab) => void;
  onCompany: (id: string) => void;
  /** Số tin chưa đọc (cả công ty mình lẫn đối tác); 0 ⇒ không hiện số. */
  unreadTotal: number;
  companies: readonly MsgCompany[];
  hasMore: boolean;
  loadingMore: boolean;
  onMore: () => void;
};

const tabCls = (on: boolean) =>
  cn(
    "h-8 shrink-0 rounded-lg px-3 text-label",
    on ? "bg-act-soft font-semibold text-ink" : "text-dim hover:bg-sunk",
  );

export function ListTabs(p: ListTabsProps) {
  const { t } = useTranslation();
  const picked = p.companies.find((c) => c.id === p.view.company)?.name;
  return (
    <div
      role="toolbar"
      aria-label={t("contracts.messages.tabsLabel")}
      data-testid="list-tabs"
      className="flex shrink-0 items-center gap-1 px-3 pb-2"
    >
      <button
        type="button"
        aria-pressed={p.view.tab === "all"}
        data-testid="tab-all"
        className={tabCls(p.view.tab === "all")}
        onClick={() => p.onTab("all")}
      >
        {t("contracts.messages.tabAll")}
      </button>
      <button
        type="button"
        aria-pressed={p.view.tab === "unread"}
        data-testid="tab-unread"
        className={tabCls(p.view.tab === "unread")}
        onClick={() => p.onTab("unread")}
      >
        {t("contracts.messages.tabUnread")}
        {p.unreadTotal > 0 && (
          <span data-testid="tab-unread-n" className="ml-1.5 font-semibold text-late">
            {p.unreadTotal > 99 ? "99+" : p.unreadTotal}
          </span>
        )}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-pressed={p.view.tab === "partner"}
            data-testid="tab-partner"
            className={cn(tabCls(p.view.tab === "partner"), "max-w-44 truncate")}
          >
            {picked ?? t("contracts.messages.tabPartner")} ▾
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 w-64" data-testid="partner-menu">
          {p.companies.length === 0 && !p.hasMore && (
            <p className="m-0 px-2 py-2 text-label text-dim">
              {t("contracts.messages.partnerNone")}
            </p>
          )}
          {p.companies.map((c) => (
            <DropdownMenuItem
              key={c.id}
              data-testid="partner-item"
              onSelect={() => p.onCompany(c.id)}
            >
              <span className="truncate">{c.name}</span>
            </DropdownMenuItem>
          ))}
          {p.hasMore && <LoadSentinel loading={p.loadingMore} onMore={p.onMore} />}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
