// HUB-FR-67 · D1 · một bước của profile: Provider · Model · "Chuyển bước kế khi" + Lên/Xuống/Xoá bước (không kéo-thả).
import { memo, useId } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { type DraftStep, TRIGGERS, type Trigger } from "../lib/profile-draft";

type Props = {
  step: DraftStep;
  index: number;
  count: number;
  providers: readonly string[];
  error?: { provider?: string; model?: string };
  onChange: (uid: number, patch: Partial<DraftStep>) => void;
  onMove: (index: number, by: -1 | 1) => void;
  onRemove: (uid: number) => void;
};

export const StepRow = memo(function StepRow({
  step,
  index,
  count,
  providers,
  error,
  onChange,
  onMove,
  onRemove,
}: Props) {
  const { t } = useTranslation();
  const id = useId();
  const known = step.provider_key === "" || providers.includes(step.provider_key);
  const options = known ? providers : [...providers, step.provider_key];
  const toggle = (trg: Trigger, on: boolean) =>
    onChange(step.uid, { on: on ? [...step.on, trg] : step.on.filter((x) => x !== trg) });
  return (
    <li className="space-y-3 rounded-lg border border-border bg-card p-3">
      <div className="flex items-start gap-3">
        <span className="mt-2 w-5 text-label text-muted-foreground">{index + 1}</span>
        <div className="grid flex-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Select
              value={step.provider_key}
              onValueChange={(v) => onChange(step.uid, { provider_key: v })}
            >
              <SelectTrigger
                className="w-full font-mono"
                aria-label={t("models.profile.field.provider")}
                aria-invalid={!!error?.provider}
              >
                <SelectValue placeholder={t("models.profile.field.provider")}>
                  {step.provider_key || null}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {options.map((k) => (
                  <SelectItem key={k} value={k}>
                    {k}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {error?.provider ? (
              <p className="text-label text-destructive">{t(error.provider)}</p>
            ) : null}
          </div>
          <div className="space-y-1">
            <Input
              aria-label={t("models.profile.field.model")}
              aria-invalid={!!error?.model}
              value={step.model}
              autoComplete="off"
              className="font-mono"
              onChange={(e) => onChange(step.uid, { model: e.target.value })}
            />
            {error?.model ? <p className="text-label text-destructive">{t(error.model)}</p> : null}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 pl-8">
        <fieldset
          aria-label={t("models.profile.field.on")}
          className="m-0 flex min-w-0 flex-wrap items-center gap-3 border-0 p-0"
        >
          <span aria-hidden className="text-label text-muted-foreground">
            {t("models.profile.field.on")}
          </span>
          {TRIGGERS.map((trg) => (
            <div key={trg} className="flex items-center gap-1.5">
              <Checkbox
                id={`${id}-${trg}`}
                checked={step.on.includes(trg)}
                onCheckedChange={(v) => toggle(trg, v === true)}
              />
              <Label htmlFor={`${id}-${trg}`}>{t(`models.profile.on.${trg}`)}</Label>
            </div>
          ))}
        </fieldset>
        <div className="flex gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={index === 0}
            onClick={() => onMove(index, -1)}
          >
            {t("models.profile.step.up")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={index === count - 1}
            onClick={() => onMove(index, 1)}
          >
            {t("models.profile.step.down")}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => onRemove(step.uid)}>
            {t("models.profile.step.remove")}
          </Button>
        </div>
      </div>
    </li>
  );
});
