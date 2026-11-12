// COM-FR-27 · CR-120 · phần Community đóng góp cho thanh trên DÙNG CHUNG của AppShell: ô tìm (debounce 250 ms) + dev persona (mock) vào khe
// "search", (CR-130: chuông là chuông chung của shell). Không còn header/brand/burger/avatar riêng (khung, menu trái và menu tài khoản do shell cấp).
// Khe là phần tử DOM của shell (host.slots) — vẽ bằng portal; chưa có khe (test/ngoài shell) ⇒ không vẽ gì.
import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useApp } from "../application/ctx";
import { getCommunityHostConfig } from "../application/host";
import { t } from "../i18n";
import { IconSearch } from "./icons";

const noSlots = { get: () => null, subscribe: () => () => undefined };

function useSlot(name: "search"): HTMLElement | null {
  const slots = getCommunityHostConfig()?.slots ?? noSlots;
  return useSyncExternalStore(
    slots.subscribe,
    () => slots.get(name),
    () => null,
  );
}

/** Portal vào khe của shell; bọc `data-mod` để CSS Community (đã scoped) áp cho phần tử nằm ngoài cây trang. */
function InSlot({ name, children }: { name: "search"; children: ReactNode }) {
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

export function TopbarContrib() {
  return (
    <InSlot name="search">
      <SearchBox />
      <Persona />
    </InSlot>
  );
}
