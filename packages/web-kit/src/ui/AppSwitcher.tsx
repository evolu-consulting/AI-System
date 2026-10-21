// app-catalog · nút "Ứng dụng" dùng chung cho 4 web (admin, chat, studio, contracts): MỘT giao diện, MỘT nguồn dữ liệu
// (`GET /me/apps` — admin-api đã lọc theo vai + gói; thêm app ở Admin là hiện, không build lại). API lỗi ⇒ `fallback()` (env build).
// Không phụ thuộc Tailwind/shadcn: style nội tuyến + biến màu của app (`--popover/--border/--muted…`) có giá trị dự phòng.
import {
  type ReactElement,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { appLabel, type MeApp, otherApps } from "../app-catalog/apps";

export type AppSwitcherProps = {
  /** Thường `() => session.myApps().then((r) => r.items)`. */
  fetchApps: () => Promise<MeApp[]>;
  /** Dùng khi `fetchApps` lỗi (danh sách dựng từ env build + vai). */
  fallback: () => MeApp[];
  /**
   * URL để mở `app` (thường `handOffUrl` của `auth/sso.ts`: xin mã một lần ⇒ `<target_url>/sso#code=…`). Chỉ gọi cho app có
   * `sso`; trả `null`/lỗi ⇒ mở thẳng `app.url` (đích tự dội về đăng nhập). App không SSO luôn mở thẳng.
   */
  handOff: (app: MeApp) => Promise<string | null>;
  /** Key của app đang chạy (không hiện trong danh sách). */
  current: string;
  locale?: string;
  /** Nhãn nút (aria-label + tooltip), vd "Ứng dụng". */
  label: string;
  /** Đổi giá trị ⇒ tải lại (vd id user sau khi đăng nhập). */
  reloadKey?: string;
};

const ICONS: Record<string, string> = {
  sparkles:
    "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
  "file-text":
    "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5 M9 13h6 M9 17h6",
  wand: "M15 4l5 5L8 21l-5-5z M13 6l5 5",
  settings:
    "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z M4 12h2 M18 12h2 M12 4v2 M12 18v2 M6.3 6.3l1.4 1.4 M16.3 16.3l1.4 1.4 M17.7 6.3l-1.4 1.4 M7.7 16.3l-1.4 1.4",
  app: "M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z",
};

function Icon({ name, size = 16 }: { name: string; size?: number }): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICONS[name] ?? ICONS.app} />
    </svg>
  );
}

const CSS = `
.ai-apps{position:relative;display:inline-flex}
.ai-apps__btn{display:inline-grid;place-items:center;width:32px;height:32px;border:0;border-radius:8px;background:transparent;color:var(--muted-foreground,#6b7280);cursor:pointer}
.ai-apps__btn:hover,.ai-apps__btn:focus-visible{background:var(--muted,var(--sunk,#f5f5f5));color:var(--foreground,inherit)}
.ai-apps__menu{position:absolute;top:36px;right:0;z-index:50;min-width:200px;padding:4px;border:1px solid var(--border,#e5e5e5);border-radius:10px;background:var(--popover,var(--card,#fff));color:var(--popover-foreground,var(--foreground,inherit));box-shadow:0 8px 24px rgba(0,0,0,.14);font-size:14px}
.ai-apps__item{display:flex;align-items:center;gap:10px;height:36px;padding:0 10px;border-radius:6px;color:inherit;text-decoration:none;outline:none}
.ai-apps__item:hover,.ai-apps__item:focus-visible{background:var(--muted,var(--sunk,#f5f5f5))}
`;

/** Tải một lần mỗi `reloadKey`; trả `null` khi đang tải (nút ẩn, không nháy). */
function useApps(p: AppSwitcherProps): MeApp[] | null {
  const [apps, setApps] = useState<MeApp[] | null>(null);
  const latest = useRef(p);
  latest.current = p;
  // biome-ignore lint/correctness/useExhaustiveDependencies: tải lại chỉ khi `reloadKey` đổi; hàm lấy từ ref
  useEffect(() => {
    let alive = true;
    latest.current.fetchApps().then(
      (r) => alive && setApps(r),
      () => alive && setApps(latest.current.fallback()),
    );
    return () => {
      alive = false;
    };
  }, [p.reloadKey]);
  return apps;
}

/** Click thường ⇒ chuyển phiên; Ctrl/Cmd/Shift/giữa ⇒ để trình duyệt mở link `href` (= URL app) như bình thường. */
async function go(
  p: AppSwitcherProps,
  a: MeApp,
  e: ReactMouseEvent<HTMLAnchorElement>,
): Promise<void> {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0 || !a.sso) return;
  e.preventDefault();
  const url = await p.handOff(a).catch(() => null);
  window.location.assign(url ?? a.url);
}

export function AppSwitcher(p: AppSwitcherProps): ReactElement | null {
  const apps = useApps(p);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const list = apps ? otherApps(apps, p.current) : [];
  if (list.length === 0) return null;
  return (
    <div ref={box} className="ai-apps" data-testid="app-switcher">
      <style>{CSS}</style>
      <button
        type="button"
        className="ai-apps__btn"
        aria-label={p.label}
        title={p.label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="app" size={18} />
      </button>
      {open && (
        <div id={panelId} role="menu" aria-label={p.label} className="ai-apps__menu">
          {list.map((a) => (
            <a
              key={a.key}
              role="menuitem"
              href={a.url}
              className="ai-apps__item"
              onClick={(e) => {
                setOpen(false);
                void go(p, a, e);
              }}
            >
              <Icon name={a.icon} />
              {appLabel(a, p.locale)}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
