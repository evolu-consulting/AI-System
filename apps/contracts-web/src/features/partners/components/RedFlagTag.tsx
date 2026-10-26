// U3 · R39 · cờ đỏ của đối tác (tách khỏi điểm, hiện bất kể số việc): nhãn "Cờ đỏ" + từng loại (Không giao / Gian lận) kèm số lần.
import { useTranslation } from "react-i18next";
import type { Flag } from "../lib/partner-score";

export function RedFlagTag({ flags }: { flags: readonly Flag[] }) {
  const { t } = useTranslation();
  if (!flags.length) return null;
  return (
    <span
      data-testid="red-flag"
      className="inline-flex flex-wrap items-center gap-1 rounded-full bg-late-bg px-2.5 py-0.5 text-[12px] font-semibold text-late"
    >
      <span aria-hidden="true">⚑</span>
      {t("contracts.pv2.flag.tag")}
      {flags.map((f) => (
        <span key={f.type} className="font-normal">
          · {t(`contracts.pv2.flag.type.${f.type}`)}
          {f.n > 1 ? ` ×${f.n}` : ""}
        </span>
      ))}
    </span>
  );
}
