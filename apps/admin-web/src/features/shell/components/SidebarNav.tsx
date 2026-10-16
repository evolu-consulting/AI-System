// ADM-FR-60, ADM-FR-04 · danh sách mục menu (dùng cho Sidebar và Sheet di động); mục hiện tại có aria-current="page".
import { Link, useRouterState } from "@tanstack/react-router";
import {
  ArrowLeftRight,
  Bot,
  Building2,
  ChevronDown,
  Coins,
  Footprints,
  History,
  KeyRound,
  LayoutDashboard,
  ListTree,
  type LucideIcon,
  Package,
  ShieldCheck,
  Terminal,
  Users,
  UsersRound,
  Workflow,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "@/lib/auth/use-session";
import { cn } from "@/lib/utils";
import { type NavId, type NavItem, navGroups } from "../lib/nav";

const ICONS: Record<NavId, LucideIcon> = {
  overview: LayoutDashboard,
  agents: Bot,
  tenants: Building2,
  users: Users,
  groups: UsersRound,
  access: ShieldCheck,
  features: Package,
  commands: Terminal,
  workflows: Workflow,
  workflowSteps: Footprints,
  workflowProcess: ListTree,
  secrets: KeyRound,
  usage: Coins,
  audit: History,
  transfer: ArrowLeftRight,
};

type Props = { collapsed?: boolean; onNavigate?: () => void };

const LINK =
  "flex h-9 items-center gap-3 rounded-md px-3 text-label font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none";

function NavLink({
  item,
  collapsed = false,
  child = false,
  onNavigate,
}: {
  item: NavItem;
  collapsed?: boolean;
  child?: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const Icon = ICONS[item.id];
  return (
    <Link
      to={item.to}
      // Mục con "Workflow Process" (/workflows) không sáng khi đang ở /workflows/steps.
      activeOptions={{ exact: item.to === "/" || child }}
      onClick={onNavigate}
      className={cn(LINK, collapsed && "justify-center px-0", child && "h-8 pl-10")}
      activeProps={{ className: "bg-sidebar-accent text-sidebar-accent-foreground" }}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      <span className={cn(collapsed && "sr-only")}>{t(item.labelKey)}</span>
    </Link>
  );
}

/** DLC-R15 · mục cha sổ xuống (mở sẵn khi đang ở một trang con). */
function NavParent({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const inside = pathname === item.to || pathname.startsWith(`${item.to}/`);
  const [open, setOpen] = useState(inside);
  const Icon = ICONS[item.id];
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(LINK, "w-full", inside && "text-sidebar-accent-foreground")}
      >
        <Icon aria-hidden className="size-4 shrink-0" />
        <span className="flex-1 text-left">{t(item.labelKey)}</span>
        <ChevronDown
          aria-hidden
          className={cn("size-4 shrink-0 transition-transform", !open && "-rotate-90")}
        />
      </button>
      {open && (
        <div className="mt-0.5 space-y-0.5">
          {item.children?.map((c) => (
            <NavLink key={c.id} item={c} child onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </div>
  );
}

export function SidebarNav({ collapsed = false, onNavigate }: Props) {
  const { t } = useTranslation();
  const role = useSession((s) => s.me?.role);
  return (
    <nav aria-label={t("nav.main")} className="flex-1 space-y-4 overflow-y-auto p-3">
      {navGroups(role).map((group) => (
        <div key={group.labelKey ?? "root"} className="space-y-1">
          {group.labelKey && !collapsed ? (
            <p className="px-3 pb-1 text-micro font-semibold tracking-wide text-subtle-foreground">
              {t(group.labelKey)}
            </p>
          ) : null}
          {group.items.map((item) =>
            item.children && !collapsed ? (
              <NavParent key={item.id} item={item} onNavigate={onNavigate} />
            ) : (
              <NavLink key={item.id} item={item} collapsed={collapsed} onNavigate={onNavigate} />
            ),
          )}
        </div>
      ))}
    </nav>
  );
}
