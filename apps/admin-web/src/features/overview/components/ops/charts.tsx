// CR-121 C-3b · biểu đồ nhẹ bằng SVG/CSS (không thêm thư viện): đường xu hướng 7 ngày + 24 cột giờ xong/lỗi. Màu theo token shell.
import { useTranslation } from "react-i18next";
import { formatClock } from "@/lib/format";
import { cn } from "@/lib/utils";
import { type HourBar, sparkPoints } from "../../lib/ops-overview";

export function Sparkline({
  series,
  tone = "primary",
}: {
  series: ReadonlyArray<number | null>;
  tone?: "primary" | "warning" | "success";
}) {
  const { t } = useTranslation();
  const points = sparkPoints(series);
  if (!points) {
    return (
      <p className="mt-auto text-caption text-muted-foreground">{t("overview.ops.trendEmpty")}</p>
    );
  }
  const stroke = {
    primary: "stroke-primary",
    warning: "stroke-warning-solid",
    success: "stroke-success",
  }[tone];
  return (
    <svg
      role="img"
      aria-label={t("overview.ops.trend7")}
      viewBox="0 0 100 28"
      preserveAspectRatio="none"
      className="mt-auto block h-7 w-full"
    >
      <polyline
        points={points}
        fill="none"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        className={stroke}
      />
    </svg>
  );
}

export function HourlyBars({ bars, empty }: { bars: HourBar[]; empty: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="mt-auto space-y-1.5">
      <div className="flex flex-wrap gap-x-4 text-caption text-muted-foreground">
        <span className="mr-auto">{t("overview.ops.hourly")}</span>
        <span className="inline-flex items-center gap-1.5">
          <i className="size-2 rounded-sm bg-primary" />
          {t("overview.ops.done")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="size-2 rounded-sm bg-warning-solid" />
          {t("overview.ops.failed")}
        </span>
      </div>
      <div
        role="img"
        aria-label={t("overview.ops.hourlyChart")}
        className="flex h-32 items-end gap-1 border-b"
      >
        {bars.map((b) => (
          <div
            key={b.hourStart}
            title={t("overview.ops.hourTip", {
              time: formatClock(b.hourStart),
              ok: b.ok,
              error: b.error,
            })}
            className="flex min-w-0 flex-1 flex-col justify-end gap-px"
            style={{ height: `${b.okPct}%` }}
          >
            <i
              className={cn("block rounded-t-sm bg-warning-solid", b.error === 0 && "hidden")}
              style={{ height: `${b.errPct}%` }}
            />
            <i className="block flex-1 rounded-t-sm bg-primary/85" />
          </div>
        ))}
      </div>
      {empty ? (
        <p className="text-caption text-muted-foreground">{t("overview.ops.hourlyEmpty")}</p>
      ) : null}
      <div aria-hidden className="flex justify-between text-caption text-muted-foreground">
        <span>{t("overview.ops.ago24")}</span>
        <span>{t("overview.ops.now")}</span>
      </div>
    </div>
  );
}
