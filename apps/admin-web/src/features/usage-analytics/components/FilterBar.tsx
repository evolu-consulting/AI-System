// ADM-FR-42 · usage-analytics · thanh lọc: tenant (chỉ platform_admin), khoảng ngày (preset), xô thời gian, app, agent,
// model, user, kết quả; "Xoá lọc". Danh sách chọn lấy từ breakdown hiện có (giá trị đang chọn luôn có trong danh sách).
import type { UsageAnalytics, UsageBreakdownRow } from "@ai/contracts";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { TenantPicker } from "@/components/shared/TenantPicker";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AnalyticsSearch, AnalyticsView } from "../hooks/use-analytics-view";
import { PRESETS, type Preset } from "../lib/view";
import { useAppLabel } from "./labels";

const ALL = "__all";
type Opt = { value: string; label: string };

function Pick(p: {
  label: string;
  value?: string;
  options: Opt[];
  onChange: (v?: string) => void;
  allLabel: string;
  width?: string;
}) {
  const opts =
    p.value && !p.options.some((o) => o.value === p.value)
      ? [{ value: p.value, label: p.value }, ...p.options]
      : p.options;
  return (
    <Select value={p.value ?? ALL} onValueChange={(v) => p.onChange(v === ALL ? undefined : v)}>
      <SelectTrigger aria-label={p.label} className={p.width ?? "w-40"}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{p.allLabel}</SelectItem>
        {opts.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const optsOf = (
  rows: readonly UsageBreakdownRow[] | undefined,
  label?: (k: string) => string,
): Opt[] =>
  (rows ?? []).flatMap((r) =>
    r.key === null ? [] : [{ value: r.key, label: label ? label(r.key) : (r.label ?? r.key) }],
  );

export function FilterBar({ v, data }: { v: AnalyticsView; data: UsageAnalytics | undefined }) {
  const { t } = useTranslation();
  const appLabel = useAppLabel();
  const s = v.search;
  const all = t("usageAnalytics.filter.all");
  const pick = (key: keyof AnalyticsSearch, label: string, options: Opt[], width?: string) => (
    <Pick
      label={label}
      value={s[key]}
      options={options}
      onChange={(x) => v.set({ [key]: x })}
      allLabel={all}
      width={width}
    />
  );
  const filtered = !!(s.app || s.agent || s.model || s.user || s.outcome);
  return (
    <fieldset
      aria-label={t("usageAnalytics.filter.label")}
      className="m-0 mb-4 flex min-w-0 flex-wrap items-center gap-2 border-0 p-0"
    >
      {v.platform ? (
        <TenantPicker
          tenants={v.tenants}
          value={v.tenantKey}
          onChange={(k) => v.set({ tenant: k ?? undefined })}
        />
      ) : null}
      <Select value={v.preset} onValueChange={(p) => v.setPreset(p as Preset)}>
        <SelectTrigger aria-label={t("usageAnalytics.filter.range")} className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PRESETS.map((p) => (
            <SelectItem key={p} value={p}>
              {t(`usageAnalytics.preset.${p}`)}
            </SelectItem>
          ))}
          {v.preset === "custom" ? (
            <SelectItem value="custom">{`${v.range.from} → ${v.range.to}`}</SelectItem>
          ) : null}
        </SelectContent>
      </Select>
      <Select value={v.grain} onValueChange={(g) => v.set({ grain: g })}>
        <SelectTrigger aria-label={t("usageAnalytics.filter.grain")} className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(["day", "week", "month"] as const).map((g) => (
            <SelectItem key={g} value={g}>
              {t(`usageAnalytics.grain.${g}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {pick("app", t("usageAnalytics.filter.app"), optsOf(data?.by_app, appLabel))}
      {pick("agent", t("usageAnalytics.filter.agent"), optsOf(data?.by_agent), "w-44")}
      {pick("model", t("usageAnalytics.filter.model"), optsOf(data?.by_model), "w-48")}
      {pick("user", t("usageAnalytics.filter.user"), optsOf(data?.by_user))}
      {pick(
        "outcome",
        t("usageAnalytics.filter.outcome"),
        (["ok", "error", "cancelled"] as const).map((o) => ({
          value: o,
          label: t(`usageAnalytics.outcome.${o}`),
        })),
        "w-36",
      )}
      {filtered ? (
        <Button type="button" variant="ghost" size="sm" onClick={v.clear}>
          <X aria-hidden className="size-4" />
          {t("usageAnalytics.filter.clear")}
        </Button>
      ) : null}
    </fieldset>
  );
}
