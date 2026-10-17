import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { readAll, readNotice, useNotices, type Notice } from "@/api/notifications";
import { logout, useMe } from "@/api/session";
import { IconBell, IconLogout, IconSettings } from "@/components/icons";
import { confirmDialog } from "@/components/dialog";
import { useTheme, type Theme } from "./theme";

const ROLE = { owner: "Quản lý", editor: "Nhân viên", viewer: "Chỉ xem" } as const;

/** A small menu that closes on an outside click or Escape. */
function Popover({ button, children, label, up = false, full = false }: {
  button: (open: boolean) => ReactNode; children: (close: () => void) => ReactNode; label: string;
  /** `up`: opens above the button, to the right (the account menu at the foot of the sidebar). */
  up?: boolean; full?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", off);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div ref={box} className={`relative ${full ? "w-full" : ""}`}>
      <button type="button" aria-label={label} aria-expanded={open} onClick={() => setOpen(!open)}
        className={`inline-flex h-11 items-center gap-2 rounded-lg px-2 text-left text-ink-2 hover:bg-sunk ${full ? "w-full" : ""} ${open ? "bg-sunk" : ""}`}>
        {button(open)}
      </button>
      {open && (
        <div className={`rise absolute z-50 w-[300px] max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border border-rule bg-panel shadow-xl ${
          up ? "bottom-0 left-full ml-2" : "top-12 right-0"}`}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function ago(iso: string) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return "vừa xong";
  if (m < 60) return `${m} phút trước`;
  if (m < 60 * 24) return `${Math.round(m / 60)} giờ trước`;
  return new Date(iso).toLocaleDateString("vi-VN");
}

/** `side`: in the sidebar's foot, the list opens to its right; "Thông báo" is written out while the bar is open. */
export function NotificationBell({ side = false, wide = true }: { side?: boolean; wide?: boolean }) {
  const q = useNotices();
  const qc = useQueryClient();
  const nav = useNavigate();
  const items = q.data ?? [];
  const unread = items.filter((n) => !n.read_at).length;

  async function open(n: Notice, close: () => void) {
    close();
    if (!n.read_at) { await readNotice(n.id); void qc.invalidateQueries({ queryKey: ["notifications"] }); }
    if (n.link) nav(n.link);
  }

  return (
    <Popover label={unread ? `Thông báo, ${unread} chưa đọc` : "Thông báo"} up={side} full={side} button={() => (
      <>
        <span className={`relative shrink-0 ${side ? "px-1" : ""}`}>
          <IconBell />
          {unread > 0 && (
            <span className="absolute -top-1.5 -right-1 grid h-4 min-w-4 place-items-center rounded-full bg-late px-1 text-[10px] font-semibold text-panel">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </span>
        {side && wide && <span className="ml-1.5 text-[14px]">Thông báo</span>}
      </>
    )}>
      {(close) => (
        <>
          <div className="flex items-center border-b border-rule px-4 py-3">
            <p className="text-[14px] font-semibold">Thông báo</p>
            {unread > 0 && (
              <button type="button" className="ml-auto text-[12.5px] text-act hover:underline"
                onClick={async () => { await readAll(); void qc.invalidateQueries({ queryKey: ["notifications"] }); }}>
                Đánh dấu đã đọc hết
              </button>
            )}
          </div>
          {!items.length ? <p className="px-4 py-8 text-center text-sm text-dim">Chưa có thông báo nào.</p> : (
            <ul className="max-h-[420px] overflow-y-auto">
              {items.slice(0, 20).map((n) => (
                <li key={n.id}>
                  <button type="button" onClick={() => open(n, close)}
                    className={`block w-full border-b border-rule-soft px-4 py-3 text-left last:border-0 hover:bg-sunk ${n.read_at ? "" : "bg-act-soft/40"}`}>
                    <span className="flex items-start gap-2">
                      {!n.read_at && <span aria-label="chưa đọc" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-act" />}
                      <span className="min-w-0">
                        <span className="block text-[13.5px] font-medium">{n.title}</span>
                        {n.body && <span className="line-clamp-2 block text-[12.5px] text-dim">{n.body}</span>}
                        <span className="block text-[11.5px] text-dim">{ago(n.created_at)}</span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Popover>
  );
}

/** Sáng (the default) · Tối · Theo máy: a three-way switch in the account menu. */
function ThemePicker() {
  const [theme, setTheme] = useTheme();
  const opts: [Theme, string][] = [["light", "☀ Sáng"], ["dark", "☾ Tối"], ["auto", "Theo máy"]];
  return (
    <div className="flex items-center gap-3 border-b border-rule-soft px-4 py-2.5 text-[13.5px]">
      <span className="text-ink-2">Giao diện</span>
      <span role="radiogroup" aria-label="Giao diện" className="ml-auto inline-flex rounded-lg border border-rule p-0.5">
        {opts.map(([v, label]) => (
          <button key={v} type="button" role="radio" aria-checked={theme === v} onClick={() => setTheme(v)}
            className={`rounded-md px-2.5 py-1 text-[12.5px] ${theme === v ? "bg-act-soft font-semibold text-act" : "text-dim hover:text-ink"}`}>
            {label}
          </button>
        ))}
      </span>
    </div>
  );
}

/** The account: at the foot of the sidebar (`side`, name shown only while the bar is open), in the top bar on phones. */
export function UserMenu({ side = false, wide = true }: { side?: boolean; wide?: boolean }) {
  const { data: me } = useMe();
  const nav = useNavigate();
  const qc = useQueryClient();
  if (!me) return null;
  const initials = (me.name || me.email).split(/\s+/).filter(Boolean).slice(-2).map((w) => w[0]).join("").toUpperCase();

  return (
    <Popover label="Tài khoản" up={side} full={side} button={() => (
      <>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-act-soft text-[12.5px] font-semibold text-act">{initials}</span>
        <span className={`min-w-0 flex-col items-start leading-tight ${wide ? "flex" : "hidden"} ${side ? "" : "max-md:hidden"}`}>
          <span className="max-w-full truncate text-[13.5px] font-semibold text-ink">{me.name}</span>
          <span className="max-w-full truncate text-[11.5px] text-dim">{me.org?.name}</span>
        </span>
      </>
    )}>
      {(close) => (
        <>
          <div className="border-b border-rule px-4 py-3">
            <p className="text-[14px] font-semibold">{me.name}</p>
            <p className="text-[12.5px] text-dim">{me.email}</p>
            {me.org && <p className="mt-1 text-[12.5px]">{me.org.name} · <span className="text-act">{ROLE[me.org.role]}</span></p>}
          </div>
          <ThemePicker />
          <Link to="/settings" onClick={close} className="flex items-center gap-2.5 px-4 py-2.5 text-[13.5px] hover:bg-sunk">
            <IconSettings width={18} height={18} /> Cài đặt
          </Link>
          <button type="button" className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[13.5px] text-late hover:bg-sunk"
            onClick={async () => {
              if (!(await confirmDialog({ title: "Đăng xuất?", body: "Bạn sẽ cần đăng nhập lại để dùng app.", confirmLabel: "Đăng xuất", danger: true }))) return;
              close(); await logout().catch(() => null); qc.clear(); nav("/login");
            }}>
            <IconLogout width={18} height={18} /> Đăng xuất
          </button>
        </>
      )}
    </Popover>
  );
}
