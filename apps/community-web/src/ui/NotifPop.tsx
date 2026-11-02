// Chuông thông báo thả xuống (tách khỏi TopBar, CR-110 COM-FR-27: chuông + badge giữ nguyên hành vi).
import type { CommunityNotification } from "@ai/contracts/community";
import { t } from "../i18n";
import { initials, timeAgo, tone } from "../lib/format";
import { useApp } from "./ctx";

export function NotifPop({
  items,
  onClose,
  onChanged,
}: {
  items: CommunityNotification[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { api, go } = useApp();
  const open = async (n: CommunityNotification) => {
    await api.markRead(n.id);
    onChanged();
    onClose();
    go({ name: "feed" });
  };
  return (
    <div className="pop" role="dialog" aria-label={t("community.topbar.notifications")}>
      <div className="pophead">
        <h3>{t("community.topbar.notifications")}</h3>
        <div className="sp" />
        <button
          type="button"
          className="linkbtn"
          onClick={async () => {
            await api.markRead();
            onChanged();
          }}
        >
          {t("community.topbar.markAllRead")}
        </button>
      </div>
      {items.length === 0 && <div className="empty">{t("community.topbar.noNotifications")}</div>}
      {items.map((n) => (
        <button
          key={n.id}
          type="button"
          className={n.unread ? "nitem unread" : "nitem"}
          onClick={() => open(n)}
        >
          <span className={`av sm ${tone(n.actorName, false)}`}>{initials(n.actorName)}</span>
          <span className="txt">
            <b>{n.actorName}</b> {n.text}
            <span>{timeAgo(n.createdAt)}</span>
          </span>
          {n.unread && (
            <span className="udot" role="img" aria-label={t("community.topbar.unread")} />
          )}
        </button>
      ))}
    </div>
  );
}
