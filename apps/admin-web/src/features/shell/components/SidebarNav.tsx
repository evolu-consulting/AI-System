// ADM-FR-60, CR-121 R1 · sidebar 6 mục phẳng (artboard `Main`), dùng cho Sidebar và Sheet di động; mục hiện tại có aria-current="page".
// Thu gọn: chỉ biểu tượng + tooltip (title). Badge số: `badges[id]` > 0 ⇒ chấm số (nguồn dữ liệu do lát sau nối).
import { Link } from "@tanstack/react-router";
import {
  Building2,
  LayoutDashboard,
  LayoutGrid,
  type LucideIcon,
  Server,
  Sparkles,
  Workflow,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useProcessEngineOn } from "@/features/processes/engine";
import { useSession } from "@/lib/auth/use-session";
import { cn } from "@/lib/utils";
import { type NavItem, navItems, type SidebarNavId } from "../lib/nav";

const ICONS: Record<SidebarNavId, LucideIcon> = {
  overview: LayoutDashboard,
  companies: Building2,
  apps: LayoutGrid,
  processes: Workflow,
  aiTools: Sparkles,
  system: Server,
};

type Props = {
  collapsed?: boolean;
  onNavigate?: () => void;
  badges?: Partial<Record<SidebarNavId, number>>;
};

const LINK =
  "relative flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-label font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none";

function NavLink({
  item,
  collapsed = false,
  badge,
  onNavigate,
}: {
  item: NavItem;
  collapsed?: boolean;
  badge?: number;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const Icon = ICONS[item.id];
  const label = t(item.labelKey);
  return (
    <Link
      to={item.to}
      title={collapsed ? label : undefined}
      activeOptions={{ exact: item.to === "/" }}
      onClick={onNavigate}
      className={cn(LINK, collapsed && "justify-center px-0")}
      activeProps={{ className: "bg-sidebar-accent text-sidebar-accent-foreground" }}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      <span className={cn(collapsed && "sr-only")}>{label}</span>
      {badge ? (
        <span
          className={cn(
            "rounded-full bg-warning-bg px-1.5 text-micro font-medium text-warning",
            collapsed ? "absolute top-0.5 right-1" : "ml-auto",
          )}
        >
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

export function SidebarNav({ collapsed = false, onNavigate, badges }: Props) {
  const { t } = useTranslation();
  const role = useSession((s) => s.me?.role);
  const processes = useProcessEngineOn(); // P-a FD2: mục "Quy trình" chỉ khi engine on
  return (
    <nav aria-label={t("nav.main")} className="flex-1 space-y-1 overflow-y-auto p-3">
      {navItems(role, { processes }).map((item) => (
        <NavLink
          key={item.id}
          item={item}
          collapsed={collapsed}
          badge={badges?.[item.id]}
          onNavigate={onNavigate}
        />
      ))}
    </nav>
  );
}
