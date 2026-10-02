// ADM-FR-36 · M3-R12 · nhóm "Feature" của AccessExplainer: feature hiệu lực kèm lý do; feature không dùng được gom sau nút "Hiện … (n)".
import type { EffectiveFeature } from "@ai/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { pickLocalized } from "@/lib/localized";
import { type ExplainCtx, grantedLines, unusableFeatureLines } from "./explain";
import { type ReasonActions, ReasonLines } from "./ReasonLines";

type Props = { features: EffectiveFeature[]; ctx: ExplainCtx; actions?: ReasonActions };

export function FeatureSection({ features, ctx, actions }: Props) {
  const { t, i18n } = useTranslation();
  const [showUnusable, setShowUnusable] = useState(false);
  const usable = features.filter((f) => f.effective);
  const unusable = features.filter((f) => !f.effective);
  return (
    <section className="space-y-3">
      <h3 className="text-label font-semibold">{t("access.check.section.features")}</h3>
      <ul className="divide-y divide-border rounded-lg border border-border bg-card">
        {usable.map((f) => (
          <li key={f.feature.id} className="space-y-0.5 px-4 py-2.5">
            <p className="font-medium">{pickLocalized(f.feature.name, i18n.language)}</p>
            <ReasonLines lines={grantedLines(f.reasons, ctx)} />
          </li>
        ))}
      </ul>
      {unusable.length > 0 ? (
        <Button variant="outline" size="sm" onClick={() => setShowUnusable(!showUnusable)}>
          {t("access.check.showUnusable", { count: unusable.length })}
        </Button>
      ) : null}
      {showUnusable ? (
        <ul className="divide-y divide-border rounded-lg border border-border bg-muted/30">
          {unusable.map((f) => (
            <li key={f.feature.id} className="space-y-1 px-4 py-2.5">
              <p className="font-medium">{pickLocalized(f.feature.name, i18n.language)}</p>
              <ReasonLines lines={unusableFeatureLines(f, ctx)} actions={actions} tone="problem" />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
