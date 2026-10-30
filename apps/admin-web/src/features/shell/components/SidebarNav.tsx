// ADM-FR-60, ADM-FR-04 · danh sách mục menu (dùng cho Sidebar và Sheet di động); mục hiện tại có aria-current="page".
import { Link } from "@tanstack/react-router";
import {
  Activity,
  ArrowLeftRight,
  Bot,
  Building2,
  Coins,
  GitBranch,
  Handshake,
  History,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  Library,
  type LucideIcon,
  MessageSquare,
  Package,
  ShieldCheck,
  Terminal,
  Users,
  UsersRound,
  Workflow,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useProcessEngineOn } from "@/features/processes/engine";
import { useSession } from "@/lib/auth/use-session";
import { frozenModulesOn } from "@/lib/frozen";
import { cn } from "@/lib/utils";
import { type NavId, type NavItem, navGroups } from "../lib/nav";

const ICONS: Record<NavId, LucideIcon> = {
  overview: LayoutDashboard,
  agents: Bot,
  tenants: Building2,
  users: Users,
  partners: Handshake,
  groups: UsersRound,
  access: ShieldCheck,
  features: Package,
  commands: Terminal,
  workflows: Workflow,
  processes: GitBranch,
  sources: Library,
  secrets: KeyRound,
  apps: LayoutGrid,
  usage: Coins,
  audit: History,
  feedback: MessageSquare,
  transfer: ArrowLeftRight,
  system: Activity,
};

type Props = { collapsed?: boolean; onNavigate?: () => void };

const LINK =
  "flex h-9 items-center gap-3 rounded-md px-3 text-label font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none";

function NavLink({
  item,
  collapsed = false,
  onNavigate,
}: {
  item: NavItem;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const Icon = ICONS[item.id];
  return (
    <Link
      to={item.to}
      activeOptions={{ exact: item.to === "/" }}
      onClick={onNavigate}
      className={cn(LINK, collapsed && "justify-center px-0")}
      activeProps={{ className: "bg-sidebar-accent text-sidebar-accent-foreground" }}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      <span className={cn(collapsed && "sr-only")}>{t(item.labelKey)}</span>
    </Link>
  );
}

export function SidebarNav({ collapsed = false, onNavigate }: Props) {
  const { t } = useTranslation();
  const role = useSession((s) => s.me?.role);
  const processes = useProcessEngineOn(); // P-a FD2: mục "Quy trình" chỉ khi engine on
  return (
    <nav aria-label={t("nav.main")} className="flex-1 space-y-4 overflow-y-auto p-3">
      {navGroups(role, { processes, frozen: frozenModulesOn }).map((group) => (
        <div key={group.labelKey ?? "root"} className="space-y-1">
          {group.labelKey && !collapsed ? (
            <p className="px-3 pb-1 text-micro font-semibold tracking-wide text-subtle-foreground">
              {t(group.labelKey)}
            </p>
          ) : null}
          {group.items.map((item) => (
            <NavLink key={item.id} item={item} collapsed={collapsed} onNavigate={onNavigate} />
          ))}
        </div>
      ))}
    </nav>
  );
}
