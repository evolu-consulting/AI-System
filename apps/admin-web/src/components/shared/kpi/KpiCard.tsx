// ADM-FR-60, ADM-FR-41, ADM-FR-42 · M4-R09 · thẻ KPI dùng chung (Tổng quan 2 role, Chi phí & quota; plan-frontend §2).
// `section` có `aria-labelledby` (e2e `region "<tiêu đề>"`); value `null` → "—" + tooltip "Chưa có dữ liệu từ Agent Hub";
// đang tải → skeleton; lỗi riêng từng thẻ (ms §12.3) — thẻ khác vẫn hiện.
import { type ReactNode, useId } from "react";
import { useTranslation } from "react-i18next";
import { ErrorState } from "@/components/shared/states/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Props = {
  title: string;
  /** `null` = chưa có dữ liệu (Agent Hub chưa nối). */
  value: ReactNode | null;
  /** Dòng phụ dưới giá trị (delta, "x chưa gắn"…). */
  note?: ReactNode;
  loading?: boolean;
  error?: { message: string; code: string; onRetry?: () => void };
  /** Nội dung thêm (QuotaBar…) dưới giá trị. */
  children?: ReactNode;
  className?: string;
};

function NoData() {
  const { t } = useTranslation();
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" aria-label={t("overview.kpi.noData")} className="rounded-sm">
            —
          </button>
        </TooltipTrigger>
        <TooltipContent>{t("overview.kpi.noData")}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function KpiCard({ title, value, note, loading, error, children, className }: Props) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      aria-busy={loading || undefined}
      className={cn(
        "space-y-2 rounded-xl border bg-card p-5 text-card-foreground shadow-sm",
        className,
      )}
    >
      <h3 id={id} className="text-label font-medium text-muted-foreground">
        {title}
      </h3>
      {error ? (
        <ErrorState {...error} />
      ) : loading ? (
        <Skeleton aria-hidden className="h-8 w-24" />
      ) : (
        <>
          <p className="text-page-title font-semibold text-foreground">
            {value === null ? <NoData /> : value}
          </p>
          {note ? <p className="text-caption text-muted-foreground">{note}</p> : null}
          {children}
        </>
      )}
    </section>
  );
}
