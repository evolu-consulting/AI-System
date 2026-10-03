// ADM-FR-40, ADM-FR-41, ADM-FR-42 · M4-R02, R06 · thanh quota dùng chung (Tổng quan, Tenants, Chi phí & quota; plan-frontend §2).
// Có giới hạn → `progressbar` (aria-valuenow ≤ 100, aria-valuetext "{used} / {limit}"); vượt 100% → thanh đầy vân chéo + nhãn.
// Giới hạn trống → chỉ chữ "{used} · Không giới hạn", KHÔNG có progressbar.
import { useTranslation } from "react-i18next";
import { formatQuotaValue, pctLevel, pctOf, type QuotaKind } from "@/lib/quota-format";
import { cn } from "@/lib/utils";

type Props = {
  /** Tên thanh cho trình đọc màn hình và e2e: "Run", "Token", "USD" hoặc "Run · Kế toán". */
  label: string;
  kind: QuotaKind;
  used: number | string;
  limit: number | string | null;
  /** Hiện nhãn ở trên thanh; mặc định có. */
  showLabel?: boolean;
  className?: string;
};

const FILL = {
  none: "bg-primary",
  warn: "bg-warning-solid",
  over: "bg-[repeating-linear-gradient(135deg,var(--color-overage-hatch-from)_0_6px,var(--color-overage-hatch-to)_6px_12px)]",
} as const;

function Badge({ pct }: { pct: number }) {
  const { t } = useTranslation();
  if (pct > 100) {
    return <span className="text-danger">{t("quota.badge.overPct", { pct: pct - 100 })}</span>;
  }
  return pct === 100 ? (
    <span className="text-danger">{t("quota.badge.over")}</span>
  ) : (
    <span className="text-warning">{t("quota.badge.warn", { pct })}</span>
  );
}

export function QuotaBar({ label, kind, used, limit, showLabel = true, className }: Props) {
  const { t, i18n } = useTranslation();
  const usedText = formatQuotaValue(kind, used, i18n.language);
  const head = showLabel ? <span className="text-label font-medium">{label}</span> : null;
  if (limit === null) {
    return (
      <div className={cn("space-y-1", className)}>
        <div className="flex items-baseline justify-between gap-2">
          {head}
          <span className="text-label text-muted-foreground">
            {t("quota.bar.unlimited", { used: usedText })}
          </span>
        </div>
      </div>
    );
  }
  const limitText = formatQuotaValue(kind, limit, i18n.language);
  const pct = pctOf(Number(used), Number(limit)) ?? 0;
  const level = pctLevel(pct);
  const valueText = t("quota.bar.used", { used: usedText, limit: limitText });
  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-baseline justify-between gap-2">
        {head}
        <span className="flex items-baseline gap-2 text-label text-muted-foreground">
          {valueText}
          {level === "none" ? null : <Badge pct={pct} />}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(pct, 100)}
        aria-valuetext={valueText}
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn("h-full rounded-full", FILL[level])}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}
