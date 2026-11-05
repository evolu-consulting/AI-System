// price-scout · dòng trạng thái của "Cấu hình dò giá": lượt dò đã dùng tháng này, lần dò gần nhất / kế tiếp.
import type { PriceScoutProductOut, PriceScoutUsage } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { viDate } from "~/components/shared/format";
import { usageView } from "../lib/scout";

/** "Đã dùng X/Y lượt tháng này" (Y = "không giới hạn" khi không có trần). */
export function UsageLine({ usage }: { usage: PriceScoutUsage }) {
  const { t } = useTranslation();
  const { used, limit } = usageView(usage);
  return (
    <p data-testid="scout-usage" className="text-sm text-dim">
      {t("contracts.scout.usage", {
        used,
        limit: limit == null ? t("contracts.scout.unlimited") : limit,
      })}
    </p>
  );
}

export function ScanLine({ data }: { data: PriceScoutProductOut }) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.scout.${k}`, o);
  return (
    <p data-testid="scout-scan" className="text-sm text-dim">
      {L("next", { at: data.next_at ? viDate(data.next_at) : L("none") })} ·{" "}
      {L("last", { at: data.last_at ? viDate(data.last_at) : L("none") })}
      {data.last_status && (
        <>
          {" · "}
          {L("status", { s: data.last_status })}
        </>
      )}
    </p>
  );
}
