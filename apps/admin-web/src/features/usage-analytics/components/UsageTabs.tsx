// ADM-FR-42 · usage-analytics · thanh chuyển giữa "Tổng quan chi phí" (/usage) và "Phân tích token" (/usage/analytics).
import { Link, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/usage", key: "overview" },
  { to: "/usage/analytics", key: "analytics" },
] as const;

export function UsageTabs() {
  const { t } = useTranslation();
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav aria-label={t("usageAnalytics.tabs.label")} className="mb-4 flex gap-1 border-b">
      {TABS.map((tab) => {
        const active = path === tab.to;
        return (
          <Link
            key={tab.to}
            to={tab.to}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-label font-medium",
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`usageAnalytics.tabs.${tab.key}`)}
          </Link>
        );
      })}
    </nav>
  );
}
