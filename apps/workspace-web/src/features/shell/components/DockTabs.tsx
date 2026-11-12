// CR-132 · W3 · tab «Trợ lý AI | Tin nhắn» ở đầu khoang phải; tab Tin nhắn có chấm đỏ + số chưa đọc.
import { useTranslation } from "react-i18next";
import { UnreadBadge } from "~/features/messages/components/UnreadBadge";
import { cn } from "~/lib/utils";
import type { DockTab } from "../hooks/use-dock";

export function DockTabs({
  tab,
  onTab,
  unread,
  onClose,
  closeLabel,
}: {
  tab: DockTab;
  onTab: (t: DockTab) => void;
  unread: number;
  /** Chỉ hiện nút thu gọn ở tab Tin nhắn (tab Trợ lý có sẵn ở đầu trợ lý). */
  onClose?: () => void;
  closeLabel?: string;
}) {
  const { t } = useTranslation();
  const item = (id: DockTab, label: string, badge = 0) => (
    <button
      type="button"
      role="tab"
      id={`dock-tab-${id}`}
      aria-selected={tab === id}
      data-testid={`dock-tab-${id}`}
      onClick={() => onTab(id)}
      className={cn(
        "relative flex h-10 items-center gap-1.5 border-b-2 px-3 text-[13.5px]",
        tab === id
          ? "border-act font-semibold text-act"
          : "border-transparent text-dim hover:text-ink",
      )}
    >
      {label}
      <UnreadBadge count={badge} />
    </button>
  );
  return (
    <div className="flex shrink-0 items-center border-b border-rule-soft px-2">
      <div role="tablist" aria-label={t("contracts.messages.dockTabs")} className="flex">
        {item("assistant", t("contracts.messages.tabAssistant"))}
        {item("messages", t("contracts.messages.tabMessages"), unread)}
      </div>
      {tab === "messages" && onClose && closeLabel && (
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded-md px-2 py-1 text-dim text-label hover:bg-sunk"
        >
          {closeLabel}
        </button>
      )}
    </div>
  );
}
