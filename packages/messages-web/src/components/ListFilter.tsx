// CR-190 · «Tất cả» / «Chưa đọc (n)» — thay hàng tab cũ (Tất cả · Chưa đọc · Đối tác ▾). Công ty đối tác nay là nhóm trong danh bạ.
import { useTranslation } from "react-i18next";
import { cn } from "../ui";

export type ListTab = "all" | "unread";

const tabCls = (on: boolean) =>
  cn(
    "h-8 shrink-0 rounded-lg px-3 text-label max-sm:h-11",
    on ? "bg-act-soft font-semibold text-ink" : "text-dim hover:bg-sunk",
  );

export function ListFilter({
  tab,
  onTab,
  unreadTotal,
}: {
  tab: ListTab;
  onTab: (t: ListTab) => void;
  /** Tổng chưa đọc của người dùng; 0 ⇒ không hiện số. */
  unreadTotal: number;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="toolbar"
      aria-label={t("contracts.messages.tabsLabel")}
      data-testid="list-tabs"
      className="flex shrink-0 items-center gap-1 px-3 pb-2"
    >
      <button
        type="button"
        aria-pressed={tab === "all"}
        data-testid="tab-all"
        className={tabCls(tab === "all")}
        onClick={() => onTab("all")}
      >
        {t("contracts.messages.tabAll")}
      </button>
      <button
        type="button"
        aria-pressed={tab === "unread"}
        data-testid="tab-unread"
        className={tabCls(tab === "unread")}
        onClick={() => onTab("unread")}
      >
        {t("contracts.messages.tabUnread")}
        {unreadTotal > 0 && (
          <span data-testid="tab-unread-n" className="ml-1.5 font-semibold text-late">
            {unreadTotal > 99 ? "99+" : unreadTotal}
          </span>
        )}
      </button>
    </div>
  );
}
