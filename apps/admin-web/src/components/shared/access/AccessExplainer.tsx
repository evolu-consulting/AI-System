// ADM-FR-36 · M3-R11, R12, R13 · AccessExplainer dùng chung (Kiểm tra quyền + tab Quyền hiệu lực của drawer user): trình bày, KHÔNG fetch.
// `actions` có → hiện nút gợi ý (Cấp … cho group…, Thêm vào beta-testers, Mở feature); không có → chỉ đọc.
import type { EffectiveAccess } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useTr } from "@/lib/use-translate";
import { CommandSection } from "./CommandSection";
import { filterCommands } from "./explain";
import { FeatureSection } from "./FeatureSection";
import type { ReasonActions } from "./ReasonLines";

type Props = {
  data: EffectiveAccess;
  /** Từ khoá ô "Tìm command" (lọc phía client). */
  query?: string;
  lang: string;
  actions?: ReasonActions;
};

const BLOCKER_KEY = {
  user_inactive: "access.reason.userInactive",
  tenant_locked: "access.reason.tenantLocked",
} as const;

export function AccessExplainer({ data, query = "", lang, actions }: Props) {
  const { t } = useTranslation();
  const tr = useTr();
  const ctx = { lang, username: data.user.username };
  const visibleCount = data.commands.filter((c) => c.visible).length;
  return (
    <div className="space-y-6">
      {data.blockers.map((b) => (
        <Alert key={b} variant="destructive">
          <AlertDescription>{tr(BLOCKER_KEY[b])}</AlertDescription>
        </Alert>
      ))}
      <p className="text-label text-muted-foreground">
        {t("access.check.summary", { visible: visibleCount, total: data.command_total })}
      </p>
      <FeatureSection features={data.features} ctx={ctx} actions={actions} />
      <CommandSection commands={filterCommands(data.commands, query)} ctx={ctx} actions={actions} />
      <section className="space-y-2">
        <h3 className="text-label font-semibold">{t("access.check.section.agents")}</h3>
        <p className="text-body text-muted-foreground">{t("users.access.agentsUnavailable")}</p>
      </section>
    </div>
  );
}
