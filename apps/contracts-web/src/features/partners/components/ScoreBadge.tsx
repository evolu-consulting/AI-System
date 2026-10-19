// HD8-FR-01 · huy hiệu điểm — port `mgmt-app/web/src/components/ui.tsx:124-141` (khung 54×48, màu theo mức, chưa có điểm ⇒ "–").
import type { ScoreBand } from "@ai/contracts";
import { useTranslation } from "react-i18next";

const CLS: Record<ScoreBand, string> = {
  good: "bg-ok-bg text-ok",
  fair: "bg-idle-bg text-ink-2",
  watch: "bg-soon-bg text-soon",
};
export const BAND_TEXT: Record<ScoreBand, string> = {
  good: "text-ok",
  fair: "text-ink-2",
  watch: "text-soon",
};

export function ScoreBadge({ score, band }: { score: number | null; band: ScoreBand | null }) {
  const { t } = useTranslation();
  if (score == null || !band)
    return (
      <span
        className="grid h-12 w-[54px] shrink-0 place-items-center rounded-lg border border-dashed border-field text-lg text-dim"
        role="img"
        aria-label={t("contracts.partners.noScore")}
      >
        –
      </span>
    );
  return (
    <span
      className={`flex h-12 w-[54px] shrink-0 flex-col items-center justify-center rounded-lg ${CLS[band]}`}
    >
      <span className="tnum text-lg leading-none font-semibold">{score}</span>
      <span className="mt-0.5 text-[10px] font-semibold tracking-wide">
        {t(`contracts.partners.badge.${band}`)}
      </span>
    </span>
  );
}
