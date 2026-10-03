// ADM-FR-51, ADM-FR-52 · M4-R12 · lọc thời gian: nút `button "Thời gian: 30 ngày"` mở Popover có preset 7/30/90 ngày
// và 2 ô ngày (plan-frontend D3, không react-day-picker). Chọn preset áp dụng ngay; tuỳ chọn cần bấm "Áp dụng".
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { isValidCustom, PERIOD_PRESETS, type Period } from "./period";

type Props = {
  value: Period;
  onChange: (value: Period) => void;
  className?: string;
};

export function PeriodFilter({ value, onChange, className }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(value.kind === "custom" ? value.from : "");
  const [to, setTo] = useState(value.kind === "custom" ? value.to : "");
  const label =
    value.kind === "preset"
      ? t("audit.period.days", { n: value.days })
      : `${t("audit.period.custom")}: ${value.from} – ${value.to}`;

  const pickPreset = (v: string) => {
    if (!v) return; // bấm lại mục đang chọn → giữ nguyên
    onChange({ kind: "preset", days: Number(v) as (typeof PERIOD_PRESETS)[number] });
    setOpen(false);
  };
  const apply = () => {
    onChange({ kind: "custom", from, to });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className={className}>
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-3">
        <ToggleGroup
          type="single"
          value={value.kind === "preset" ? String(value.days) : ""}
          onValueChange={pickPreset}
          aria-label={t("audit.period.label")}
        >
          {PERIOD_PRESETS.map((d) => (
            <ToggleGroupItem key={d} value={String(d)}>
              {t("audit.period.preset", { n: d })}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="space-y-1.5">
          <Label htmlFor="period-from">{t("audit.period.from")}</Label>
          <Input
            id="period-from"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="period-to">{t("audit.period.to")}</Label>
          <Input
            id="period-to"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <Button
          type="button"
          className="w-full"
          disabled={!isValidCustom(from, to)}
          onClick={apply}
        >
          {t("audit.period.apply")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
