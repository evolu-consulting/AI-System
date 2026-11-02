// Thanh trên 60px (mockup): logo "Sổ Hợp Tác · Community", ô tìm bo tròn, Bảng tin / chuông (thả xuống) / cài đặt / avatar.
import type { CommunityNotification } from "@ai/contracts/community";
import { useCallback, useEffect, useState } from "react";
import { apiMode } from "../api";
import { logout } from "../api/auth";
import { t } from "../i18n";
import { initials, timeAgo, tone } from "../lib/format";
import { useApp } from "./ctx";
import { IconBell, IconGear, IconHome, IconSearch } from "./icons";

function NotifPop({
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

export function TopBar() {
  const { api, viewer, route, go, rev, search, setSearch, personas, setPersona } = useApp();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ items: CommunityNotification[]; unread: number }>({
    items: [],
    unread: 0,
  });
  const [draft, setDraft] = useState(search);
  const load = useCallback(() => {
    api.listNotifications().then(setData, () => undefined);
  }, [api]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: nạp lại khi dữ liệu đổi (rev)
  useEffect(load, [load, rev]);
  useEffect(() => {
    const t = setTimeout(() => setSearch(draft), 250);
    return () => clearTimeout(t);
  }, [draft, setSearch]);

  return (
    <>
      <header className="top">
        <button
          type="button"
          className="brand"
          onClick={() => go({ name: "feed" })}
          aria-label={t("community.topbar.backToFeed")}
        >
          <span className="logo">S</span>
          <span>
            <b>{t("community.brand.name")}</b>
            <small>{t("community.brand.sub")}</small>
          </span>
        </button>
        <div className="search">
          <IconSearch size={16} />
          <input
            type="search"
            placeholder={t("community.topbar.searchPlaceholder")}
            aria-label={t("community.topbar.searchLabel")}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </div>
        <div className="sp" />
        {personas && (
          <label className="persona" title={t("community.topbar.devOnlyMock")}>
            {t("community.topbar.devViewAs")}
            <select
              aria-label={t("community.topbar.pickPersona")}
              value={viewer.userId}
              onChange={(e) => setPersona(e.target.value)}
            >
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          className={route.name === "feed" ? "navtab on" : "navtab"}
          onClick={() => go({ name: "feed" })}
        >
          <IconHome />
          <span className="navlabel">{t("community.topbar.feed")}</span>
        </button>
        <button
          type="button"
          className={open ? "iconbtn on" : "iconbtn"}
          onClick={() => setOpen(!open)}
          aria-label={t("community.topbar.notifications")}
        >
          <IconBell size={20} />
          {data.unread > 0 && <span className="badge">{data.unread}</span>}
        </button>
        <button
          type="button"
          className={route.name === "settings" ? "iconbtn on" : "iconbtn"}
          onClick={() => go({ name: "settings" })}
          aria-label={t("community.topbar.settings")}
        >
          <IconGear size={20} />
        </button>
        <button
          type="button"
          className={route.name === "profile" ? "avbtn on" : "avbtn"}
          onClick={() => go({ name: "profile" })}
          aria-label={t("community.topbar.profileOf", { org: viewer.orgName })}
        >
          <span className="av t1">{initials(viewer.orgName)}</span>
        </button>
        {apiMode === "http" && (
          <button type="button" className="ghost" onClick={() => void logout()}>
            {t("community.topbar.logout")}
          </button>
        )}
      </header>
      {open && <NotifPop items={data.items} onClose={() => setOpen(false)} onChanged={load} />}
    </>
  );
}
