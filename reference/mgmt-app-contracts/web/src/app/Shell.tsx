import { useEffect, useState, type ComponentType, type SVGProps } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { logUi } from "@/api/logs";
import { AssistantPanel } from "@/assistant/Panel";
import { pageContext } from "@/assistant/context";
import { IconContract, IconFeedback, IconPartners, IconPrices, IconRobot, IconSignature } from "@/components/icons";
import { FeedbackPanel, FEEDBACK_OPEN } from "@/feedback/FeedbackDialog";
import { APP_NAME, APP_TAGLINE } from "./brand";
import { NotificationBell, UserMenu } from "./TopBar";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;
/** The places on the mock; everything else (payments included) lives in the assistant. */
const NAV: { to: string; label: string; icon: Icon }[] = [
  { to: "/contracts", label: "Hợp đồng", icon: IconContract },
  { to: "/partners", label: "Đối tác", icon: IconPartners },
  { to: "/prices", label: "So sánh giá", icon: IconPrices },
  // the products the company sells; "Chữ ký số" is the first (and for now only) one — the page picks it
  { to: "/cks", label: "Sản phẩm", icon: IconSignature },
];

/** The brand mark (Evolu Consulting icon) from public/. */
const Logo = ({ className = "" }: { className?: string }) => <img src="/evolu-icon.svg" alt="" className={className} />;

const ASSISTANT_MIN = 280, ASSISTANT_MAX = 560;
const clampW = (n: number) => Math.min(ASSISTANT_MAX, Math.max(ASSISTANT_MIN, n));
const isWide = () => window.matchMedia("(min-width: 1024px)").matches;

/** Remembered per browser; storage may be blocked (private mode), then the default stands. */
function useStored(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(() => {
    try { const s = localStorage.getItem(key); return s == null ? initial : s === "1"; } catch { return initial; }
  });
  return [v, (x) => { setV(x); try { localStorage.setItem(key, x ? "1" : "0"); } catch { /* not kept */ } }];
}
function useStoredNum(key: string, initial: number): [number, (n: number) => void] {
  const [v, setV] = useState(() => {
    try { const n = Number(localStorage.getItem(key)); return Number.isFinite(n) && n > 0 ? n : initial; } catch { return initial; }
  });
  return [v, (n) => { setV(n); try { localStorage.setItem(key, String(n)); } catch { /* not kept */ } }];
}

/** Left bar: icons only, opens over the page while hovered or focused. */
function Sidebar() {
  const [hover, setHover] = useState(false);
  const wide = hover;
  const item = (n: { to: string; label: string; icon: Icon }) => (
    <NavLink key={n.to} to={n.to} title={wide ? undefined : n.label} onClick={() => setHover(false)}
      className={({ isActive }) => `flex h-11 items-center gap-3 rounded-lg px-3 text-[14px] whitespace-nowrap transition-colors ${
        isActive ? "bg-act-soft font-semibold text-act" : "text-ink-2 hover:bg-sunk"}`}>
      <n.icon className="shrink-0" />
      <span className={wide ? "" : "sr-only"}>{n.label}</span>
    </NavLink>
  );
  return (
    // the rail keeps its 64px in the layout; the open bar floats over the page
    <div className="relative h-dvh w-16 shrink-0 max-md:hidden">
      <nav aria-label="Điều hướng chính" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setHover(false); }}
        className={`absolute inset-y-0 left-0 z-30 flex flex-col gap-1 border-r border-rule bg-panel px-2.5 py-3 transition-[width] duration-150 ${
          wide ? "w-[224px] shadow-xl" : "w-16"}`}>
        <Link to="/contracts" className="mb-3 flex h-10 items-center gap-2.5 overflow-hidden px-1.5" title={APP_NAME}>
          <Logo className="h-8 w-8 shrink-0" />
          {wide && (
            <span className="min-w-0 leading-tight">
              <span className="block text-[15.5px] font-bold tracking-tight">{APP_NAME}</span>
              <span className="block truncate text-[11px] text-dim">{APP_TAGLINE}</span>
            </span>
          )}
        </Link>
        {NAV.map(item)}
        <div className="mt-auto flex flex-col gap-1 border-t border-rule pt-2">
          <UserMenu side wide={wide} />
        </div>
      </nav>
    </div>
  );
}

export default function Shell() {
  const { pathname, search } = useLocation();
  const ctx = pageContext(pathname, search);
  useEffect(() => { logUi("view", pathname + search); }, [pathname, search]);   // activity log: pages opened

  // The right panel is docked on wide screens (it shares its slot: the assistant, or the feedback form), and opens
  // as a bottom sheet on phones. The assistant's open state is remembered; feedback is a one-off.
  const [assistant, setAssistant] = useStored("assistant:open", true);
  const [feedback, setFeedback] = useState(false);
  const [sheet, setSheet] = useState<"assistant" | "feedback" | null>(null);
  const [width, setWidth] = useStoredNum("assistant:width", 340);
  const panelOpen = assistant || feedback;

  const openAssistant = () => { if (isWide()) { setFeedback(false); setAssistant(true); } else setSheet("assistant"); };
  const openFeedback = () => { if (isWide()) setFeedback(true); else setSheet("feedback"); };
  // the header icon, the assistant (open_form) and the old /feedback link all raise this one event
  useEffect(() => {
    const h = () => openFeedback();
    window.addEventListener(FEEDBACK_OPEN, h);
    return () => window.removeEventListener(FEEDBACK_OPEN, h);
  }, []);

  // drag the panel's left edge to set its width (clamped, remembered)
  const [dragging, setDragging] = useState(false);
  function startResize(e: React.MouseEvent) {
    e.preventDefault();
    setDragging(true);
    const move = (ev: MouseEvent) => setWidth(clampW(window.innerWidth - ev.clientX));
    const up = () => {
      setDragging(false);
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  const here = NAV.find((n) => pathname.startsWith(n.to));    // the section's name is the page title in the header
  // list pages fill the width and hold their own vertical scroll (toolbar + pager stay put); reading pages keep
  // the centred column. From md up only — phones keep the natural page scroll under the bottom bar.
  // So sánh giá · chữ ký số (the default item) shows two tables side by side, so it wants a wide column that
  // scrolls as a page, not one in-table scroll.
  const pricesCks = pathname === "/prices" && (new URLSearchParams(search).get("product") ?? "cks") === "cks";
  const board = ["/contracts", "/partners", "/prices", "/cks"].includes(pathname) && !pricesCks;

  return (
    <div className={`flex h-dvh overflow-hidden ${dragging ? "cursor-col-resize select-none" : ""}`}>
      <Sidebar />
      <div className="flex h-dvh min-w-0 flex-1 flex-col">
        <header className="flex h-[58px] shrink-0 items-center gap-3 border-b border-rule bg-panel px-5 max-md:px-3">
          <Link to="/contracts" className="flex items-center gap-2 md:hidden"><Logo className="h-7 w-7" /><span className="text-[16px] font-bold tracking-tight">{APP_NAME}</span></Link>
          <h1 className="text-[15px] font-semibold max-md:hidden">{here?.label}</h1>
          <div className="ml-auto flex items-center gap-1">
            <NotificationBell />
            <button type="button" onClick={openFeedback} aria-label="Góp ý về app" title="Góp ý về app"
              className="grid h-10 w-10 place-items-center rounded-lg text-ink-2 hover:bg-sunk"><IconFeedback /></button>
            <span className="md:hidden"><UserMenu /></span>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <main className={`min-w-0 flex-1 overflow-y-auto px-7 py-7 max-md:px-4 max-md:pb-28 ${board ? "md:flex md:flex-col md:overflow-hidden" : ""}`}>
            <div className={board ? "mx-auto w-full max-w-[1600px] md:flex md:min-h-0 md:flex-1 md:flex-col md:overflow-y-auto"
              : pricesCks ? "mx-auto w-full max-w-[1500px]"
              : `mx-auto ${panelOpen ? "max-w-[900px]" : "max-w-[1100px]"}`}><Outlet /></div>
          </main>
          {panelOpen && (
            <aside aria-label={feedback ? "Góp ý về app" : "Trợ lý AI"} style={{ width: clampW(width) }}
              className="relative shrink-0 border-l border-rule bg-panel max-lg:hidden">
              {/* drag handle on the left edge */}
              <div onMouseDown={startResize} role="separator" aria-label="Kéo để chỉnh rộng" aria-orientation="vertical"
                className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-act-soft" />
              {feedback
                ? <FeedbackPanel onClose={() => setFeedback(false)} />
                : <AssistantPanel ctx={ctx} onClose={() => setAssistant(false)} closeLabel="Thu gọn ›" />}
            </aside>
          )}
        </div>
      </div>

      {/* Phone: the places sit in a bottom bar within thumb reach. */}
      <nav aria-label="Điều hướng" className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-rule bg-panel md:hidden">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} className={({ isActive }) =>
            `flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] ${isActive ? "font-semibold text-act" : "text-dim"}`}>
            <n.icon width={19} height={19} />
            {n.label}
          </NavLink>
        ))}
      </nav>

      {/* The assistant opens from a floating button at the corner (docked on wide screens, a sheet on phones).
          Same robot mark and gradient as the panel's header, so it reads as the assistant. */}
      <button type="button" onClick={openAssistant} aria-label="Mở trợ lý AI" title="Trợ lý AI"
        className={`fixed right-5 bottom-20 z-30 grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-act to-[#a855f7] text-on-act shadow-lg transition-transform hover:scale-105 active:scale-95 md:right-6 md:bottom-6 ${
          panelOpen ? "lg:hidden" : ""} ${sheet ? "hidden" : ""}`}>
        <IconRobot width={24} height={24} />
      </button>

      {sheet && (
        <div className="fixed inset-0 z-40 flex flex-col bg-black/40 lg:hidden" onClick={() => setSheet(null)}>
          <div className="rise mt-auto h-[85dvh] overflow-hidden rounded-t-2xl bg-panel" onClick={(e) => e.stopPropagation()}>
            {sheet === "feedback"
              ? <FeedbackPanel onClose={() => setSheet(null)} />
              : <AssistantPanel ctx={ctx} onClose={() => setSheet(null)} />}
          </div>
        </div>
      )}
    </div>
  );
}
