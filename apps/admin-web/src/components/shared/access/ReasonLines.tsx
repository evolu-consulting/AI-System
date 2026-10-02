// ADM-FR-36 · M3-R12 · hiển thị danh sách lý do (mỗi lý do một dòng riêng) kèm hành động gợi ý; chế độ chỉ đọc không có hành động.
import type { FeatureMini } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { pickLocalized } from "@/lib/localized";
import { useTr } from "@/lib/use-translate";
import type { Reason } from "./explain";

export type ReasonActions = {
  /** Chỉ platform_admin thấy link "Mở feature …" (M3-R12). */
  isPlatform: boolean;
  username: string;
  onGrant?: (feature: FeatureMini) => void;
  onAddBeta?: () => void;
};

function Action({ r, a }: { r: Reason; a: ReasonActions }) {
  const { t, i18n } = useTranslation();
  const act = r.action;
  if (!act) return null;
  if (act.kind === "grant" && a.onGrant) {
    const onGrant = a.onGrant;
    const feature = pickLocalized(act.feature.name, i18n.language);
    return (
      <Button variant="outline" size="sm" onClick={() => onGrant(act.feature)}>
        {t("access.check.grantTo", { feature })}
      </Button>
    );
  }
  if (act.kind === "beta" && a.onAddBeta) {
    return (
      <Button variant="outline" size="sm" onClick={a.onAddBeta}>
        {t("access.check.addBeta", { user: a.username })}
      </Button>
    );
  }
  if (act.kind === "open" && a.isPlatform && r.params.feature) {
    return (
      <Button variant="link" size="sm" asChild>
        <Link
          to="/features/$featureId"
          params={{ featureId: act.featureId }}
          search={{ tab: "tenants" }}
        >
          {t("access.check.openFeature", { feature: r.params.feature })}
        </Link>
      </Button>
    );
  }
  return null;
}

type Props = { lines: Reason[]; actions?: ReasonActions; tone?: "muted" | "problem" };

export function ReasonLines({ lines, actions, tone = "muted" }: Props) {
  const tr = useTr();
  return (
    <div className="space-y-1">
      {lines.map((r) => (
        <div
          key={`${r.key}:${Object.values(r.params).join("|")}`}
          className="flex flex-wrap items-center gap-2"
        >
          <p
            className={
              tone === "problem" ? "text-body text-foreground" : "text-label text-muted-foreground"
            }
          >
            {tr(r.key, r.params)}
          </p>
          {actions ? <Action r={r} a={actions} /> : null}
        </div>
      ))}
    </div>
  );
}
