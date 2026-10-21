// gap-c #13 · trang "Tất cả thông báo" dùng chung: danh sách phân trang theo con trỏ ("Tải thêm"), đánh dấu từng cái / tất cả đã đọc,
// và form tùy chọn (neo `#prefs`). Mỗi app chỉ cần một route mỏng bọc trang này (truyền `onNavigate` của router, `swUrl`, `labels`).
import { type CSSProperties, type ReactElement, useMemo } from "react";
import { type NotifyTransport, notifyClient } from "../notify/client";
import { useFeed } from "../notify/hooks";
import { mergeLabels, type NotifyLabels } from "../notify/labels";
import { NotifyPrefsPanel } from "./NotifyPrefsPanel";

export type NotificationsPageProps = {
  onNavigate?: (href: string) => void;
  swUrl?: string;
  labels?: Partial<NotifyLabels>;
  transport?: NotifyTransport;
};

const WRAP: CSSProperties = {
  maxWidth: 760,
  margin: "0 auto",
  padding: "24px 20px",
  display: "grid",
  gap: 20,
};
const ITEM: CSSProperties = {
  display: "block",
  width: "100%",
  padding: "12px 16px",
  border: 0,
  borderBottom: "1px solid var(--rule, var(--border, #e5e5e5))",
  background: "transparent",
  color: "inherit",
  textAlign: "left",
  font: "inherit",
  cursor: "pointer",
};

const when = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("vi-VN");
};

export function NotificationsPage(p: NotificationsPageProps): ReactElement {
  const L = mergeLabels(p.labels);
  const client = useMemo(() => notifyClient(p.transport), [p.transport]);
  const feed = useFeed(client);
  const open = (n: { id: string; read: boolean; link: string | null }) => {
    if (!n.read) void feed.readOne(n.id);
    if (n.link) {
      if (p.onNavigate) p.onNavigate(n.link);
      else window.location.assign(n.link);
    }
  };
  return (
    <main style={WRAP}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>{L.title}</h1>
        {feed.unread > 0 && (
          <button type="button" onClick={() => void feed.readAll()}>
            {L.readAll}
          </button>
        )}
      </header>
      <section aria-label={L.title}>
        {feed.items.length === 0 && !feed.loading && <p>{feed.error ? L.failed : L.empty}</p>}
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {feed.items.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                style={{ ...ITEM, fontWeight: n.read ? 400 : 600 }}
                onClick={() => open(n)}
              >
                {!n.read && (
                  <span
                    role="img"
                    aria-label={L.unreadDot}
                    style={{
                      display: "inline-block",
                      width: 8,
                      height: 8,
                      marginRight: 8,
                      borderRadius: 4,
                      background: "var(--primary, #2563eb)",
                    }}
                  />
                )}
                {n.title}
                {n.body !== "" && (
                  <span style={{ display: "block", fontWeight: 400, fontSize: 13, opacity: 0.75 }}>
                    {n.body}
                  </span>
                )}
                <span style={{ display: "block", fontWeight: 400, fontSize: 12, opacity: 0.6 }}>
                  {when(n.created_at)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {feed.loading && <p>{L.loading}</p>}
        {feed.hasMore && !feed.loading && (
          <button type="button" onClick={() => void feed.loadMore()}>
            {L.loadMore}
          </button>
        )}
      </section>
      <div>
        <h2 style={{ fontSize: 18, margin: "0 0 8px" }}>{L.prefsTitle}</h2>
        <NotifyPrefsPanel labels={p.labels} swUrl={p.swUrl} transport={p.transport} />
      </div>
    </main>
  );
}
