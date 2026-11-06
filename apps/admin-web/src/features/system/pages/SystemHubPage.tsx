// CR-121 · c22 · `/system` "Hệ thống": cổng vào các màn quản trị chung (Chi phí · Nhật ký · Góp ý · Tình trạng · Secrets · Nguồn · Bước DLC · Import/Export).
// Danh sách đọc từ registry (một nguồn), lọc theo vai; chỉ link, không sửa trang đích.
import { Link } from "@tanstack/react-router";
import {
  Activity,
  ArrowLeftRight,
  BarChart3,
  Database,
  KeyRound,
  MessageSquare,
  ScrollText,
  Workflow,
} from "lucide-react";
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { ForbiddenState } from "@/components/shared/states/ForbiddenState";
import { useSession } from "@/lib/auth/use-session";
import { frozenModulesOn } from "@/lib/frozen";
import { type SystemEntryId, systemEntriesFor } from "../lib/registry";

const ICONS: Record<SystemEntryId, ComponentType<{ className?: string }>> = {
  usage: BarChart3,
  audit: ScrollText,
  feedback: MessageSquare,
  health: Activity,
  secrets: KeyRound,
  sources: Database,
  dlcSteps: Workflow,
  transfer: ArrowLeftRight,
};

export function SystemHubPage() {
  const { t } = useTranslation();
  const role = useSession((s) => s.me?.role);
  const entries = systemEntriesFor(role, frozenModulesOn);
  if (entries.length === 0) return <ForbiddenState />;
  return (
    <>
      <PageHeader title={t("nav.system")} description={t("system.hub.subtitle")} />
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="system-hub">
        {entries.map((e) => {
          const Icon = ICONS[e.id];
          return (
            <li key={e.id}>
              <Link
                to={e.to}
                className="flex h-full items-start gap-3 rounded-lg border bg-card p-4 hover:bg-muted"
              >
                <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block font-medium text-foreground">{t(e.labelKey)}</span>
                  <span className="block text-sm text-muted-foreground">{t(e.descKey)}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
