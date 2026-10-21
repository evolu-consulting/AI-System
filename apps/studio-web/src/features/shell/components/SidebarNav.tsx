// HUB-FR-72 · CR-080 · danh sách mục menu Studio (chỉ link thật), dùng chung cho sidebar (≥ lg) và Sheet menu ở Topbar (< lg, TD #81).
import { Link } from "@tanstack/react-router";
import { Bot, Cpu, KeyRound, type LucideIcon, Network, Settings, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "#/lib/utils";
import { NAV_GROUPS, type NavId } from "../lib/nav";

const ICONS: Record<NavId, LucideIcon> = {
  agents: Bot,
  orchestrator: Network,
  models: Cpu,
  secrets: KeyRound,
  settings: Settings,
  access: ShieldCheck,
};

const ITEM = "flex h-9 items-center gap-3 rounded-md px-3 text-body";

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t("nav.label")} className="flex-1 space-y-4 overflow-y-auto p-3">
      {NAV_GROUPS.map((group) => (
        <div key={group.labelKey} className="space-y-1">
          <p className="px-3 pb-1 text-micro font-semibold tracking-wide text-subtle-foreground uppercase">
            {t(group.labelKey)}
          </p>
          {group.items.map((item) => {
            const Icon = ICONS[item.id];
            return (
              <Link
                key={item.id}
                to={item.to}
                onClick={onNavigate}
                className={cn(
                  ITEM,
                  "font-medium text-sidebar-foreground hover:bg-sidebar-accent/60",
                  "[&.active]:bg-sidebar-accent [&.active]:text-sidebar-accent-foreground",
                )}
                activeProps={{ className: "active" }}
              >
                <Icon aria-hidden className="size-4 shrink-0" />
                {t(`nav.${item.id}`)}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
