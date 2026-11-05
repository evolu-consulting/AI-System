// COM-FR-27 · CR-120 · phần Community đóng góp cho thanh trên DÙNG CHUNG của AppShell: ô tìm (debounce 250 ms) + dev persona (mock) vào khe
// "search", chuông + badge vào khe "bell". Không còn header/brand/burger/avatar riêng (khung, menu trái và menu tài khoản do shell cấp).
// Khe là phần tử DOM của shell (host.slots) — vẽ bằng portal; chưa có khe (test/ngoài shell) ⇒ không vẽ gì.
import type { CommunityNotification } from "@ai/contracts/community";
import { type ReactNode, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useApp } from "../application/ctx";
import { getCommunityHostConfig } from "../application/host";
import { t } from "../i18n";
import { IconBell, IconSearch } from "./icons";
import { NotifPop } from "./NotifPop";

const noSlots = { get: () => null, subscribe: () => () => undefined };

function useSlot(name: "search" | "bell"): HTMLElement | null {
  const slots = getCommunityHostConfig()?.slots ?? noSlots;
  return useSyncExternalStore(
    slots.subscribe,
    () => slots.get(name),
    () => null,
  );
}

/** Portal vào khe của shell; bọc `data-mod` để CSS Community (đã scoped) áp cho phần tử nằm ngoài cây trang. */
function InSlot({ name, children }: { name: "search" | "bell"; children: ReactNode }) {
  const { brandAccent } = useApp();
  const el = useSlot(name);
  if (!el) return null;
  return createPortal(
    <div data-mod="community" data-accent={brandAccent} className="cmslot">
      {children}
    </div>,
    el,
  );
}

function SearchBox() {
  const { search, setSearch } = useApp();
  const [draft, setDraft] = useState(search);
  useEffect(() => {
    const id = setTimeout(() => setSearch(draft), 250);
    return () => clearTimeout(id);
  }, [draft, setSearch]);
  return (
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
  );
}

function Persona() {
  const { viewer, personas, setPersona } = useApp();
  if (!personas) return null;
  return (
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
  );
}

function Bell() {
  const { api, rev } = useApp();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ items: CommunityNotification[]; unread: number }>({
    items: [],
    unread: 0,
  });
  const load = useCallback(() => {
    api.listNotifications().then(setData, () => undefined);
  }, [api]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: nạp lại khi dữ liệu đổi (rev)
  useEffect(load, [load, rev]);
  return (
    <>
      <button
        type="button"
        className={open ? "iconbtn on" : "iconbtn"}
        onClick={() => setOpen(!open)}
        aria-label={t("community.topbar.notifications")}
      >
        <IconBell size={20} />
        {data.unread > 0 && <span className="badge">{data.unread}</span>}
      </button>
      {open && <NotifPop items={data.items} onClose={() => setOpen(false)} onChanged={load} />}
    </>
  );
}

export function TopbarContrib() {
  return (
    <>
      <InSlot name="search">
        <SearchBox />
        <Persona />
      </InSlot>
      <InSlot name="bell">
        <Bell />
      </InSlot>
    </>
  );
}
