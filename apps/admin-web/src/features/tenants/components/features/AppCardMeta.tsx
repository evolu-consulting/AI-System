// CR-112 · ADM-FR-78 · dòng thông tin gói của thẻ app: trạng thái gói, số vai · số người (GET packs), huy hiệu "n vai không hiệu lực",
// lối tắt tới tab Phân quyền, và ghi chú Knowledge.
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import type { PackInfo } from "../../lib/apps-plan";
import type { AppLevel } from "../../lib/feature-assign";

export type RoleSummary = { total: number; ineffective: number };
type Props = {
  app: string;
  pack: PackInfo;
  roles: RoleSummary;
  level: AppLevel;
  onOpenAccess: () => void;
};

export function AppCardMeta({ app, pack, roles, level, onOpenAccess }: Props) {
  const { t } = useTranslation();
  const on = level !== "off";
  return (
    <div className="space-y-2 border-t border-border pt-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground">
        <StatusBadge tone={pack.enabled ? "ok" : "off"}>
          {t(pack.enabled ? "tenants.apps.packOn" : "tenants.apps.packOff")}
        </StatusBadge>
        <span>{t("tenants.apps.roles", { count: pack.role_count ?? roles.total })}</span>
        <span>{t("tenants.apps.members", { count: pack.member_count ?? 0 })}</span>
        {roles.ineffective > 0 ? (
          <StatusBadge tone="warn" tooltip={t("tenants.apps.ineffectiveHint")}>
            {t("tenants.apps.ineffective", { count: roles.ineffective })}
          </StatusBadge>
        ) : null}
        <Button variant="link" size="sm" className="h-auto p-0" onClick={onOpenAccess}>
          {t("tenants.apps.openAccess")}
        </Button>
      </div>
      {app === "knowledge" && on ? (
        <p className="text-caption text-muted-foreground">{t("tenants.apps.knowledgeNote")}</p>
      ) : null}
    </div>
  );
}
