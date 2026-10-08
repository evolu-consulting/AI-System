// HUB-FR-72 · sidebar 248px: tên app "✦ Agent Forge" + menu; mục chưa làm là `aria-disabled` + SoonBadge (không route chết).
import { Link } from "@tanstack/react-router";
import {
  ArrowLeftRight,
  Bot,
  Coins,
  Cpu,
  FlaskConical,
  History,
  KeyRound,
  LayoutDashboard,
  type LucideIcon,
  Network,
  Play,
  Server,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { SoonBadge } from "#/components/shared/SoonBadge";
import { cn } from "#/lib/utils";
import { NAV_GROUPS, type NavId } from "../lib/nav";

const ICONS: Record<NavId, LucideIcon> = {
  overview: LayoutDashboard,
  agents: Bot,
  orchestrator: Network,
  tools: Wrench,
  models: Cpu,
  secrets: KeyRound,
  access: ShieldCheck,
  playground: FlaskConical,
  runs: Play,
  cost: Coins,
  jobs: Server,
  audit: History,
  transfer: ArrowLeftRight,
};

const ITEM = "flex h-9 items-center gap-3 rounded-md px-3 text-body";

export function Sidebar() {
  const { t } = useTranslation();
  return (
    <aside className="hidden w-sidebar shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
      <div className="flex h-topbar items-center px-4">
        <span className="text-card-title font-bold text-primary-strong">{t("app.name")}</span>
      </div>
      <nav aria-label={t("nav.label")} className="flex-1 space-y-4 overflow-y-auto p-3">
        {NAV_GROUPS.map((group) => (
          <div key={group.labelKey ?? "root"} className="space-y-1">
            {group.labelKey ? (
              <p className="px-3 pb-1 text-micro font-semibold tracking-wide text-subtle-foreground uppercase">
                {t(group.labelKey)}
              </p>
            ) : null}
            {group.items.map((item) => {
              const Icon = ICONS[item.id];
              if (item.kind === "link") {
                return (
                  <Link
                    key={item.id}
                    to={item.to}
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
              }
              return (
                <span
                  key={item.id}
                  aria-disabled="true"
                  className={cn(ITEM, "cursor-not-allowed text-subtle-foreground")}
                >
                  <Icon aria-hidden className="size-4 shrink-0" />
                  <span className="flex-1">{t(`nav.${item.id}`)}</span>
                  <SoonBadge kind={item.soon} />
                </span>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
