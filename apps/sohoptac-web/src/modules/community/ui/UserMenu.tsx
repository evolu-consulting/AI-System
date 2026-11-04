// COM-FR-30 · user-menu từ avatar: đầu menu = công ty + tên · vai; đúng 3 mục (Tường nhà · Cài đặt chung · Đăng xuất).
// `role=menu`, Esc / bấm ngoài / chọn mục đóng; mũi tên di chuyển. Đăng xuất = phiên chung (host.logout),
// dùng chung cho Sổ Hợp Tác và Community. Mock (dev) không có phiên ⇒ không có mục Đăng xuất.
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useApp } from "../application/ctx";
import { apiMode } from "../application/runtime";
import { t } from "../i18n";
import { IconGear, IconLogout, IconUser } from "./icons";

export function UserMenu() {
  const { viewer, brand, go, openSettings, logout } = useApp();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    wrap.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) btn.current?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = [...(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const step = e.key === "ArrowDown" ? 1 : -1;
    items[(i + step + items.length) % items.length]?.focus();
    e.preventDefault();
  };
  const pick = (fn: () => void) => () => {
    close(false);
    fn();
  };
  const role =
    viewer.role === "host_admin"
      ? t("community.profile.roleAdmin")
      : viewer.role === "host_member"
        ? t("community.profile.roleMember")
        : t("community.profile.rolePartner");

  return (
    <div className="umwrap" ref={wrap}>
      <button
        ref={btn}
        type="button"
        className={open ? "avbtn on" : "avbtn"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("community.topbar.account")}
        onClick={() => setOpen(!open)}
      >
        <span className="av t1">{brand.initial}</span>
      </button>
      {open && (
        <div
          className="usermenu"
          role="menu"
          aria-label={t("community.topbar.account")}
          onKeyDown={onKey}
        >
          <div className="umhead">
            <span className="av t1">{brand.initial}</span>
            <div>
              <div className="umn">{viewer.orgName}</div>
              <div className="umr">
                {viewer.name} · {role}
              </div>
            </div>
          </div>
          <button
            type="button"
            role="menuitem"
            className="umitem"
            onClick={pick(() => go({ name: "profile" }))}
          >
            <IconUser size={17} />
            {t("community.topbar.menuProfile")}
          </button>
          <button type="button" role="menuitem" className="umitem" onClick={pick(openSettings)}>
            <IconGear size={17} />
            {t("community.topbar.menuSettings")}
          </button>
          {apiMode === "http" && (
            <>
              <hr className="umdiv" />
              <button
                type="button"
                role="menuitem"
                className="umitem danger"
                onClick={pick(() => void logout())}
              >
                <IconLogout size={17} />
                {t("community.topbar.logout")}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
