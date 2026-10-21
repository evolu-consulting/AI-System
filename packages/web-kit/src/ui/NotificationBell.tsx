// gap-c #13/#35 · chuông thông báo DÙNG CHUNG cho 4 web (đặt trong slot phải của `TopShell`, trước switcher "Ứng dụng"). Mở ra 10 thông báo
// mới nhất, "Đánh dấu tất cả đã đọc", và chân luôn có "Xem tất cả" + "Cài đặt thông báo" (form tùy chọn luôn với tới được, kể cả khi chưa có
// thông báo). Style nội tuyến + biến màu của app như `AppSwitcher`. Điều hướng: `onNavigate(href)` (router của app) hoặc <a href>.
import { type CSSProperties, type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { type NotifyTransport, notifyClient } from "../notify/client";
import { useBell } from "../notify/hooks";
import { mergeLabels, type NotifyLabels } from "../notify/labels";

export type NotificationBellProps = {
  /** Đường dẫn trang "Tất cả thông báo" (studio: có base, vd `/studio/notifications`). */
  viewAllHref?: string;
  settingsHref?: string;
  onNavigate?: (href: string) => void;
  labels?: Partial<NotifyLabels>;
  pollMs?: number;
  /** Client HTTP riêng của app (admin/studio); vắng ⇒ `http.ts` của kit. */
  transport?: NotifyTransport;
};

const BTN: CSSProperties = {
  position: "relative",
  display: "grid",
  placeItems: "center",
  width: 36,
  height: 36,
  border: 0,
  borderRadius: 10,
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
};
const BADGE: CSSProperties = {
  position: "absolute",
  top: 2,
  right: 0,
  minWidth: 16,
  height: 16,
  padding: "0 4px",
  borderRadius: 8,
  background: "var(--destructive, #dc2626)",
  color: "#fff",
  fontSize: 10,
  fontWeight: 600,
  lineHeight: "16px",
  textAlign: "center",
};
const PANEL: CSSProperties = {
  position: "absolute",
  right: 0,
  top: 42,
  zIndex: 50,
  width: 340,
  maxWidth: "calc(100vw - 24px)",
  border: "1px solid var(--rule, var(--border, #e5e5e5))",
  borderRadius: 12,
  background: "var(--popover, var(--panel, var(--card, #fff)))",
  color: "var(--foreground, inherit)",
  boxShadow: "0 8px 24px rgba(0,0,0,.12)",
  fontSize: 14,
  textAlign: "left",
};
const ROW: CSSProperties = {
  display: "block",
  width: "100%",
  padding: "10px 16px",
  border: 0,
  borderBottom: "1px solid var(--rule, var(--border, #e5e5e5))",
  background: "transparent",
  color: "inherit",
  textAlign: "left",
  cursor: "pointer",
  font: "inherit",
};
const LINK: CSSProperties = {
  color: "var(--primary, var(--act, #2563eb))",
  fontSize: 13,
  fontWeight: 500,
  background: "none",
  border: 0,
  padding: 0,
  cursor: "pointer",
  textDecoration: "none",
};

function BellIcon(): ReactElement {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7z M10 20a2 2 0 0 0 4 0" />
    </svg>
  );
}

export function NotificationBell(p: NotificationBellProps): ReactElement {
  const L = mergeLabels(p.labels);
  const viewAll = p.viewAllHref ?? "/notifications";
  const settings = p.settingsHref ?? `${viewAll}#prefs`;
  const client = useMemo(() => notifyClient(p.transport), [p.transport]);
  const bell = useBell(client, p.pollMs);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const go = (href: string) => {
    setOpen(false);
    if (p.onNavigate) p.onNavigate(href);
    else window.location.assign(href);
  };
  const anchor = (href: string, text: string) => (
    <a
      href={href}
      style={LINK}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        go(href);
      }}
    >
      {text}
    </a>
  );
  const label = bell.unread ? L.bellUnread(bell.unread) : L.bell;
  return (
    <div ref={root} style={{ position: "relative" }}>
      <button
        type="button"
        style={BTN}
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (!open) void bell.refresh();
          setOpen(!open);
        }}
      >
        <BellIcon />
        {bell.unread > 0 && <span style={BADGE}>{bell.unread > 9 ? "9+" : bell.unread}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label={L.title} style={PANEL}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 16px",
              borderBottom: "1px solid var(--rule, var(--border, #e5e5e5))",
            }}
          >
            <strong>{L.title}</strong>
            {bell.unread > 0 && (
              <button type="button" style={LINK} onClick={() => void bell.readAll()}>
                {L.readAll}
              </button>
            )}
          </div>
          {bell.items.length === 0 ? (
            <p style={{ margin: 0, padding: "28px 16px", textAlign: "center", opacity: 0.7 }}>
              {L.empty}
            </p>
          ) : (
            <ul
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                maxHeight: 360,
                overflowY: "auto",
              }}
            >
              {bell.items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    style={{ ...ROW, fontWeight: n.read ? 400 : 600 }}
                    onClick={() => {
                      if (!n.read) void bell.readOne(n.id);
                      if (n.link) go(n.link);
                    }}
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
                      <span
                        style={{
                          display: "block",
                          fontWeight: 400,
                          fontSize: 12,
                          opacity: 0.7,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {n.body}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 16px" }}>
            {anchor(viewAll, L.viewAll)}
            {anchor(settings, L.settings)}
          </div>
        </div>
      )}
    </div>
  );
}
