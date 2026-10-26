// U3 · R46 · "xem trước": bao nhiêu đối tác đổi mức nếu lưu bản nháp (`POST /scoring/:role/preview`, không ghi). Debounce 400 ms.
import type { PartnerRole, ScoringDraft } from "@ai/contracts";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useScoringPreview } from "../hooks/use-scoring";
import { Panel } from "./controls";

export function ScoringImpact({ role, draft }: { role: PartnerRole; draft: ScoringDraft | null }) {
  const { t } = useTranslation();
  const s = (k: string, o?: Record<string, unknown>) => t(`contracts.settings.score.${k}`, o);
  const [debounced, setDebounced] = useState<ScoringDraft | null>(null);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(draft), 400);
    return () => clearTimeout(id);
  }, [draft]);
  const q = useScoringPreview(role, draft ? debounced : null);
  if (!draft) return null;
  const p = q.data;
  return (
    <Panel title={s("impactTitle")}>
      <div className="px-5 py-3 text-label" data-testid="score-impact" aria-live="polite">
        {q.isLoading || !debounced ? (
          <span className="text-dim">{s("impactLoading")}</span>
        ) : q.error || !p ? (
          <span className="text-late">{s("impactFail")}</span>
        ) : (
          <>
            <b>{s("impactCount", { n: p.changed_band, total: p.total })}</b>
            <ul className="mt-2 space-y-1 text-caption text-dim">
              {p.changes.slice(0, 5).map((c) => (
                <li key={c.party}>
                  {c.name}: {c.old ?? "–"} → {c.new ?? "–"}
                  {c.band_old !== c.band_new &&
                    ` · ${c.band_old ? s(`band.${c.band_old}`) : "–"} → ${c.band_new ? s(`band.${c.band_new}`) : "–"}`}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Panel>
  );
}
