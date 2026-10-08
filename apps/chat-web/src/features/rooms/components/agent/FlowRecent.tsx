// CR-050 · trên khối agent ở timeline: ≤ 3 comment mới nhất của thread (avatar, tên, một dòng, giờ). Chưa xem → nền accent,
// tên đậm, chấm + "Chưa xem" cho trình đọc màn hình. Bấm một dòng = mở thread (`?flow=`), mở thread mới bỏ highlight.
import type { RoomFlowRecent, RoomMessage } from "@ai/contracts/chat";
import { MessageCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/utils";
import { initialsOf } from "../../../shell/lib/conversation-path";
import { agentName } from "../../lib/room-agent";
import { timeOf } from "../../lib/room-logic";

type Props = {
  flow: NonNullable<RoomMessage["flow"]>;
  /** Mở thread; vắng ⇒ dòng không bấm được. */
  onOpen?: () => void;
};

function Row({ item, onOpen }: { item: RoomFlowRecent; onOpen?: () => void }) {
  const { t, i18n } = useTranslation();
  const name =
    item.sender_type === "agent"
      ? agentName(item.agent, i18n.language, t("roomAgent.orchestratorName"))
      : item.sender.display_name;
  return (
    <li>
      <button
        type="button"
        disabled={!onOpen}
        onClick={onOpen}
        data-unread={item.unread || undefined}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
          item.unread && "bg-accent hover:bg-accent",
        )}
      >
        <span
          aria-hidden
          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-accent-foreground"
        >
          {initialsOf(name)}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm">
          <span
            className={cn(
              "mr-1",
              item.unread ? "font-bold text-accent-foreground" : "font-semibold text-foreground",
            )}
          >
            {name}
          </span>
          <span className="text-secondary-foreground">{item.preview}</span>
        </span>
        <span className="shrink-0 text-caption text-muted-foreground">
          {timeOf(item.created_at)}
        </span>
        {item.unread && (
          <>
            <span aria-hidden className="size-2 shrink-0 rounded-full bg-primary" />
            <span className="sr-only">{t("roomAgent.recent.unread")}</span>
          </>
        )}
      </button>
    </li>
  );
}

export function FlowRecent({ flow, onOpen }: Props) {
  const { t } = useTranslation();
  const recent = flow.recent ?? [];
  if (recent.length === 0) return null;
  const unread = flow.unread ?? 0;
  return (
    <section
      aria-label={t("roomAgent.recent.label")}
      className="flex flex-col gap-0.5 border-t border-row-divider pt-2.5"
    >
      <p className="flex items-center gap-1.5 px-2 pb-1 text-caption text-muted-foreground">
        <MessageCircle className="size-3.5" aria-hidden />
        <span className="grow">{t("roomAgent.recent.title")}</span>
        {unread > 0 && (
          <span className="font-semibold text-primary-strong">
            {t("roomAgent.recent.new", { count: unread })}
          </span>
        )}
      </p>
      <ul className="flex flex-col gap-0.5">
        {recent.map((r) => (
          <Row key={r.id} item={r} onOpen={onOpen} />
        ))}
      </ul>
    </section>
  );
}
