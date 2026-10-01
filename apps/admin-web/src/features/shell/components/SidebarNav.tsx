// ADM-FR-60, ADM-FR-04 · danh sách mục menu (dùng cho Sidebar và Sheet di động); mục hiện tại có aria-current="page".
import { Link } from "@tanstack/react-router";
import {
  Building2,
  KeyRound,
  LayoutDashboard,
  type LucideIcon,
  Package,
  Terminal,
  Users,
  Workflow,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSession } from "@/lib/auth/use-session";
import { cn } from "@/lib/utils";
import { type NavId, navGroups } from "../lib/nav";

const ICONS: Record<NavId, LucideIcon> = {
  overview: LayoutDashboard,
  tenants: Building2,
  users: Users,
  features: Package,
  commands: Terminal,
  workflows: Workflow,
  secrets: KeyRound,
};

type Props = { collapsed?: boolean; onNavigate?: () => void };

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
          {group.items.map((item) => {
            const Icon = ICONS[item.id];
            return (
              <Link
                key={item.id}
                to={item.to}
                activeOptions={{ exact: item.to === "/" }}
                onClick={onNavigate}
                className={cn(
                  "flex h-9 items-center gap-3 rounded-md px-3 text-label font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                  collapsed && "justify-center px-0",
                )}
                activeProps={{ className: "bg-sidebar-accent text-sidebar-accent-foreground" }}
              >
                <Icon aria-hidden className="size-4 shrink-0" />
                <span className={cn(collapsed && "sr-only")}>{t(item.labelKey)}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
