// app-catalog · nút "Ứng dụng" (biểu tượng lưới, góc trên bên phải) dùng chung cho 4 web (admin, chat, studio, contracts): MỘT giao
// diện, MỘT nguồn dữ liệu (`GET /me/apps` — admin-api đã lọc theo vai + gói; thêm app ở Admin là hiện, không build lại).
// Danh sách = MỌI app mở được, kể cả app hiện tại (có dấu "hiện tại", không bấm được). API lỗi ⇒ `fallback()` (env build).
// Bàn phím/ARIA: nút `aria-haspopup=menu`; mở ⇒ focus mục đầu bấm được; ↑/↓/Home/End di chuyển, Esc đóng và trả focus, Tab đóng.
// Không phụ thuộc Tailwind/shadcn: style nội tuyến + biến màu của app (`--popover/--border/--muted…`) có giá trị dự phòng.
import {
  type ReactElement,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  appDescription,
  appLabel,
  entryNext,
  entryUrl,
  HOME_KEY,
  HOME_NEXT,
  type MeApp,
  withCurrent,
} from "../app-catalog/apps";

export type AppSwitcherProps = {
  /** Thường `() => session.myApps().then((r) => r.items)`. */
  fetchApps: () => Promise<MeApp[]>;
  /** Dùng khi `fetchApps` lỗi (danh sách dựng từ env build + vai). */
  fallback: () => MeApp[];
  /**
   * URL để mở `app` (thường `handOffUrl` của `auth/sso.ts`: xin mã một lần ⇒ `<target_url>/sso#code=…`). Chỉ gọi cho app có
   * `sso`; trả `null`/lỗi ⇒ mở thẳng `app.url` (đích tự dội về đăng nhập). App không SSO luôn mở thẳng.
   */
  handOff: (app: MeApp, next: string) => Promise<string | null>;
  /** Key của app đang chạy (hiện trong danh sách, đánh dấu, không bấm được). */
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
  home: "M3 11l9-8 9 8 M5 10v10h5v-6h4v6h5V10",
};

/** Biểu tượng app (dùng chung cho thẻ app ở trang chủ AI System). */
export function Icon({ name, size = 16 }: { name: string; size?: number }): ReactElement {
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

// Cùng kích thước nút với thanh trên của Sổ Hợp Tác (40px, bo 10px); màu theo biến của từng app, sáng/tối đều có dự phòng.
const CSS = `
.ai-apps{position:relative;display:inline-flex}
.ai-apps__btn{display:inline-grid;place-items:center;width:40px;height:40px;border:0;border-radius:10px;background:transparent;color:var(--ink-2,var(--muted-foreground,#6b7280));cursor:pointer}
.ai-apps__btn:hover,.ai-apps__btn:focus-visible{background:var(--sunk,var(--muted,#f5f5f5));color:var(--foreground,inherit)}
.ai-apps__menu{position:absolute;top:44px;right:0;z-index:50;min-width:260px;padding:4px;border:1px solid var(--rule,var(--border,#e5e5e5));border-radius:10px;background:var(--panel,var(--popover,var(--card,#fff)));color:var(--popover-foreground,var(--foreground,inherit));box-shadow:0 8px 24px rgba(0,0,0,.14);font-size:14px}
.ai-apps__item{display:flex;align-items:center;gap:10px;min-height:48px;padding:6px 10px;border-radius:6px;color:inherit;text-decoration:none;outline:none}
a.ai-apps__item:hover,a.ai-apps__item:focus-visible{background:var(--sunk,var(--muted,#f5f5f5))}
.ai-apps__item[aria-disabled=true]{cursor:default;background:var(--sunk,var(--muted,#f5f5f5))}
.ai-apps__txt{display:flex;flex-direction:column;min-width:0;flex:1}
.ai-apps__name{font-weight:600;line-height:1.25}
.ai-apps__desc{font-size:12px;line-height:1.25;opacity:.7}
.ai-apps__cur{font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;border:1px solid currentColor;opacity:.75;white-space:nowrap}
`;

/** Tải một lần mỗi `reloadKey`; trả `null` khi đang tải (nút ẩn, không nháy). */
function useApps(p: AppSwitcherProps): MeApp[] | null {
  const [apps, setApps] = useState<MeApp[] | null>(null);
  const latest = useRef(p);
  latest.current = p;
  // Trang chủ (`portal`) cùng origin với Chat AI: danh sách vẫn phải có Chat AI.
  const appKey = () => (latest.current.current === HOME_KEY ? "chat" : latest.current.current);
  // biome-ignore lint/correctness/useExhaustiveDependencies: tải lại chỉ khi `reloadKey` đổi; hàm lấy từ ref
  useEffect(() => {
    let alive = true;
    latest.current.fetchApps().then(
      (r) => alive && setApps(withCurrent(r, appKey())),
      () => alive && setApps(withCurrent(latest.current.fallback(), appKey())),
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
  it: Entry,
  e: ReactMouseEvent<HTMLAnchorElement>,
): Promise<void> {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0 || !it.hand) return;
  e.preventDefault();
  const url = await p.handOff(it.target, it.next).catch(() => null);
  window.location.assign(url ?? it.href);
}

/** Một dòng menu: `app` để hiển thị, `target` là app cần xin mã SSO (Trang chủ ⇒ Chat AI), `href` là link thường. */
type Entry = { app: MeApp; target: MeApp; next: string; href: string; hand: boolean };

const HOME_LABEL = { vi: "Trang chủ AI System", en: "AI System home" };

/**
 * portal-home · mục đầu tiên "Trang chủ AI System" (trang chủ nằm trên origin của Chat AI, `/?home=1`). Đang ở chat-web/trang chủ ⇒ link
 * cùng origin; app khác ⇒ chuyển phiên sang Chat AI với `next=/?home=1`. Không có Chat AI trong catalog (không đến được) ⇒ không hiện.
 */
function entriesOf(apps: readonly MeApp[], current: string): Entry[] {
  // Đang ở origin của Chat AI/trang chủ: mục Chat AI và Trang chủ là link cùng origin, không xin mã SSO cho chính mình.
  const local = current === "chat" || current === HOME_KEY;
  const list: Entry[] = apps.map((a) => ({
    app: a,
    target: a,
    next: entryNext(a),
    href: entryUrl(a),
    hand: a.sso && !(local && a.key === "chat"),
  }));
  const chat = apps.find((a) => a.key === "chat");
  if (!chat || (!local && chat.url === "")) return list;
  const home: MeApp = { key: HOME_KEY, name: HOME_LABEL, icon: "home", url: "", sso: false };
  const entry: Entry = {
    app: home,
    target: chat,
    next: HOME_NEXT,
    href: `${local ? "" : chat.url}${HOME_NEXT}`,
    hand: !local && chat.sso,
  };
  return [entry, ...list];
}

const isVi = (locale: string | undefined): boolean => !locale?.startsWith("en");

export function AppSwitcher(p: AppSwitcherProps): ReactElement | null {
  const apps = useApps(p);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) btn.current?.focus();
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: `close` chỉ dùng setState/ref ổn định
  useEffect(() => {
    if (!open) return;
    box.current?.querySelector<HTMLElement>("a[role=menuitem]")?.focus();
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close(true);
      return;
    }
    if (e.key === "Tab") return close(false);
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>("a[role=menuitem]")];
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next: Record<string, number> = {
      ArrowDown: (at + 1) % items.length,
      ArrowUp: (at - 1 + items.length) % items.length,
      Home: 0,
      End: items.length - 1,
    };
    const to = next[e.key];
    if (to === undefined) return;
    e.preventDefault();
    items[to]?.focus();
  };
  if (!apps || apps.length === 0) return null;
  const entries = entriesOf(apps, p.current);
  return (
    <div ref={box} className="ai-apps" data-testid="app-switcher">
      <style>{CSS}</style>
      <button
        ref={btn}
        type="button"
        className="ai-apps__btn"
        aria-label={p.label}
        title={p.label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Icon name="app" size={18} />
      </button>
      {open && (
        // biome-ignore lint/a11y/noStaticElementInteractions: menu ARIA; phím điều hướng bắt ở container
        <div
          id={panelId}
          role="menu"
          aria-label={p.label}
          className="ai-apps__menu"
          onKeyDown={onMenuKey}
        >
          {entries.map((it) => {
            const a = it.app;
            const body = (
              <>
                <Icon name={a.icon} />
                <span className="ai-apps__txt">
                  <span className="ai-apps__name">{appLabel(a, p.locale)}</span>
                  {appDescription(a, p.locale) && (
                    <span className="ai-apps__desc">{appDescription(a, p.locale)}</span>
                  )}
                </span>
              </>
            );
            if (a.key === p.current) {
              return (
                <div
                  key={a.key}
                  role="menuitem"
                  aria-disabled="true"
                  tabIndex={-1}
                  aria-current="true"
                  data-current="true"
                  className="ai-apps__item"
                >
                  {body}
                  <span className="ai-apps__cur">{isVi(p.locale) ? "Đang dùng" : "Current"}</span>
                </div>
              );
            }
            return (
              <a
                key={a.key}
                role="menuitem"
                href={it.href}
                className="ai-apps__item"
                onClick={(e) => {
                  setOpen(false);
                  void go(p, it, e);
                }}
              >
                {body}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
