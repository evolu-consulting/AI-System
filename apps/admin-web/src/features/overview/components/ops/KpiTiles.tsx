// CR-121 C-3b · các ô số liệu của Tổng quan platform: ô lớn "Lượt chạy 24 giờ" + 5 ô nhỏ (tỷ lệ lỗi, thời gian xử lý, lỗi công cụ AI, hạn mức AI, công ty hoạt động).
import type { OpsOverview } from "@ai/contracts/hub-admin";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatCount, formatUsd } from "@/lib/quota-format";
import { cn } from "@/lib/utils";
import { type Delta, deltaOf, fmtDec, hourBars } from "../../lib/ops-overview";
import { BentoTile, type TileError } from "./BentoTile";
import { HourlyBars, Sparkline } from "./charts";

type Common = { loading: boolean; error: TileError | null };
type Kpi = OpsOverview["kpi"];

function DeltaLine({ d, unit }: { d: Delta; unit?: string }) {
  const { t, i18n } = useTranslation();
  const n = fmtDec(d.diff, i18n.language) ?? "";
  const text =
    d.dir === "none"
      ? t("overview.ops.delta.none")
      : t(`overview.ops.delta.${d.dir}`, { n: `${n}${unit ?? ""}` });
  return <p className="text-caption text-muted-foreground">{text}</p>;
}

function Value({ value, unit, empty }: { value: string | null; unit?: string; empty: string }) {
  if (value === null) {
    return (
      <div>
        <p className="text-page-title font-semibold text-foreground">—</p>
        <p className="text-caption text-muted-foreground">{empty}</p>
      </div>
    );
  }
  return (
    <p className="flex items-baseline gap-2">
      <span className="font-mono text-page-title font-semibold tabular-nums text-foreground">
        {value}
      </span>
      {unit ? <span className="text-label text-muted-foreground">{unit}</span> : null}
    </p>
  );
}

function Small(
  p: Common & {
    name: string;
    value: string | null;
    unit?: string;
    empty: string;
    delta?: ReactNode;
    series: ReadonlyArray<number | null>;
    tone?: "primary" | "warning" | "success";
    /** Ô lẻ cuối hàng ở màn vừa: kéo rộng để lưới không trống. */
    wide?: boolean;
    link?: Parameters<typeof BentoTile>[0]["link"];
    children?: ReactNode;
  },
) {
  const { t } = useTranslation();
  return (
    <BentoTile
      title={t(`overview.ops.kpi.${p.name}.title`)}
      tip={t(`overview.ops.kpi.${p.name}.tip`)}
      link={p.link}
      loading={p.loading}
      error={p.error}
      className={cn("md:col-span-3 xl:col-span-4", p.wide && "md:col-span-6")}
    >
      <Value value={p.value} unit={p.unit} empty={p.empty} />
      {p.children}
      {p.delta}
      <Sparkline series={p.series} tone={p.tone} />
    </BentoTile>
  );
}

export function RunsTile({
  k,
  hourly,
  ...c
}: Common & { k?: Kpi["runs"]; hourly?: OpsOverview["hourly"] }) {
  const { t, i18n } = useTranslation();
  const f = (n: number) => formatCount(n, i18n.language);
  const { bars, total } = hourBars(hourly ?? []);
  const parts: [string, number, string][] = k
    ? [
        ["running", k.running, "bg-primary"],
        ["failed", k.failed, "bg-warning-solid"],
        ["needsDecision", k.needs_decision, "bg-success"],
      ]
    : [];
  return (
    <BentoTile
      title={t("overview.ops.kpi.runs.title")}
      tip={t("overview.ops.kpi.runs.tip")}
      loading={c.loading}
      error={c.error}
      className="md:col-span-6 xl:col-span-8 xl:row-span-2"
    >
      {k ? (
        <>
          <div className="flex flex-wrap items-baseline gap-x-7 gap-y-1">
            <span className="flex items-baseline gap-2">
              <span className="font-mono text-5xl font-medium tabular-nums">{f(k.value)}</span>
              <span className="text-label text-muted-foreground">
                {t("overview.ops.unit.runs")}
              </span>
            </span>
            {parts.map(([key, n, dot]) => (
              <span
                key={key}
                className="inline-flex items-baseline gap-1.5 text-label text-muted-foreground"
              >
                <i aria-hidden className={cn("size-2 self-center rounded-full", dot)} />
                {t(`overview.ops.runs.${key}`)}
                <span className="font-mono text-lg tabular-nums text-foreground">{f(n)}</span>
              </span>
            ))}
          </div>
          <DeltaLine d={deltaOf(k.value, k.yesterday)} />
          {k.value === 0 ? (
            <p className="text-caption text-muted-foreground">{t("overview.ops.runs.empty")}</p>
          ) : null}
          <HourlyBars bars={bars} empty={total === 0} />
        </>
      ) : null}
    </BentoTile>
  );
}

export function KpiTiles({ k, ...c }: Common & { k?: Kpi }) {
  const { t, i18n } = useTranslation();
  const loc = i18n.language;
  if (!k) {
    // Đang tải/lỗi: ô nhỏ hiện đúng khung để lưới không nhảy.
    return (
      <>
        {(["errorRate", "p95", "aiErrors", "aiQuota", "companies"] as const).map((n) => (
          <Small
            key={n}
            {...c}
            name={n}
            wide={n === "companies"}
            value={null}
            empty=""
            series={[]}
          />
        ))}
      </>
    );
  }
  const er = k.error_rate;
  const p = k.p95;
  const q = k.ai_quota;
  const co = k.companies;
  return (
    <>
      <Small
        {...c}
        name="errorRate"
        value={fmtDec(er.value, loc)}
        unit="%"
        tone="warning"
        empty={t("overview.ops.kpi.errorRate.empty")}
        series={er.series}
        delta={<DeltaLine d={deltaOf(er.value, er.yesterday)} unit="%" />}
      />
      <Small
        {...c}
        name="p95"
        value={fmtDec(p.minutes, loc)}
        unit={t("overview.ops.unit.minutes")}
        empty={t("overview.ops.kpi.p95.empty")}
        series={p.series}
        delta={<DeltaLine d={deltaOf(p.minutes, p.yesterday_minutes)} />}
      />
      <Small
        {...c}
        name="aiErrors"
        value={formatCount(k.ai_tool_errors.value, loc)}
        unit={t("overview.ops.unit.times")}
        tone="warning"
        empty=""
        series={k.ai_tool_errors.series}
        delta={<DeltaLine d={deltaOf(k.ai_tool_errors.value, k.ai_tool_errors.yesterday)} />}
      />
      <Small
        {...c}
        name="aiQuota"
        value={fmtDec(q.used_pct, loc)}
        unit={t("overview.ops.unit.pctUsed")}
        empty={t("overview.ops.kpi.aiQuota.empty")}
        series={q.series}
        link={{ to: "/usage" }}
        delta={
          q.used_pct === null ? undefined : (
            <p className="text-caption text-muted-foreground">
              {t("overview.ops.kpi.aiQuota.of", {
                used: formatUsd(q.used_usd, loc),
                limit: formatUsd(q.limit_usd, loc),
              })}
            </p>
          )
        }
      >
        {q.used_pct === null ? null : (
          <div
            role="progressbar"
            aria-label={t("overview.ops.kpi.aiQuota.title")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(100, Math.round(q.used_pct))}
            className="h-1 overflow-hidden rounded-full bg-muted"
          >
            <i
              className="block h-full bg-primary"
              style={{ width: `${Math.min(100, q.used_pct)}%` }}
            />
          </div>
        )}
      </Small>
      <Small
        {...c}
        name="companies"
        value={formatCount(co.active_7d, loc)}
        unit={t("overview.ops.kpi.companies.unit", { total: formatCount(co.total, loc) })}
        tone="success"
        wide
        empty=""
        series={co.series}
        link={{ to: "/tenants" }}
        delta={
          co.total === 0 ? (
            <p className="text-caption text-muted-foreground">
              {t("overview.ops.kpi.companies.empty")}
            </p>
          ) : undefined
        }
      />
    </>
  );
}
