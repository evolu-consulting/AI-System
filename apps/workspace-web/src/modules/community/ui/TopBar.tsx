// COM-FR-27 · Topbar 60px: brand công ty chủ quản (logo + tên, không logo "Sổ Hợp Tác"), burger (≤ 900 px mở drawer Sidebar),
// ô tìm (debounce 250 ms), chuông + badge, avatar → user-menu. Không navtab Bảng tin / bánh răng / nút Đăng xuất riêng.
import type { CommunityNotification } from "@ai/contracts/community";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "../application/ctx";
import { t } from "../i18n";
import { IconBell, IconMenu, IconSearch } from "./icons";
import { NotifPop } from "./NotifPop";
import { UserMenu } from "./UserMenu";

export function BrandMark({ className = "logo" }: { className?: string }) {
  const { brand } = useApp();
  return brand.logo ? (
    <img className={`${className} img`} src={brand.logo} alt="" />
  ) : (
    <span className={className}>{brand.initial}</span>
  );
}

export function TopBar({ navOpen, onToggleNav }: { navOpen: boolean; onToggleNav: () => void }) {
  const { api, viewer, brand, go, rev, search, setSearch, personas, setPersona } = useApp();
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
          className="burger"
          aria-label={navOpen ? t("community.nav.close") : t("community.nav.open")}
          aria-expanded={navOpen}
          aria-controls="shell-nav"
          onClick={onToggleNav}
        >
          <IconMenu size={20} />
        </button>
        <button
          type="button"
          className="brand"
          onClick={() => go({ name: "feed" })}
          aria-label={t("community.topbar.backToFeed")}
        >
          <BrandMark />
          <span>
            <b>{brand.name}</b>
            {brand.appName && <small>{brand.appName}</small>}
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
          className={open ? "iconbtn on" : "iconbtn"}
          onClick={() => setOpen(!open)}
          aria-label={t("community.topbar.notifications")}
        >
          <IconBell size={20} />
          {data.unread > 0 && <span className="badge">{data.unread}</span>}
        </button>
        <UserMenu />
      </header>
      {open && <NotifPop items={data.items} onClose={() => setOpen(false)} onChanged={load} />}
    </>
  );
}
