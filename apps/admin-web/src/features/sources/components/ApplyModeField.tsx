// HUB-FR-129 · PC2-R02 · FC5 · ô "Chế độ áp" trong form nguồn git: 3 lựa chọn; `pr`/`auto_merge` mờ khi host không phải GitHub
// (gitProviderOf). URL đổi sang host không hỗ trợ khi đang chọn pr/auto_merge ⇒ về branch_only. "Mặc định" theo effectiveApplyMode.
import type { ApplyMode } from "@ai/contracts/hub-admin";
import { effectiveApplyMode, gitProviderOf } from "@ai/contracts/hub-admin";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

const MODES: ApplyMode[] = ["pr", "auto_merge", "branch_only"];
const NEEDS_PROVIDER = (m: ApplyMode): boolean => m === "pr" || m === "auto_merge";

type Props = {
  id: string;
  url: string;
  /** "" = mặc định theo host (chưa chọn); giá trị = chế độ đã chọn. */
  value: "" | ApplyMode;
  onChange: (mode: ApplyMode) => void;
  error?: string;
};

export function ApplyModeField({ id, url, value, onChange, error }: Props) {
  const { t } = useTranslation();
  const supported = gitProviderOf(url.trim()) !== null;
  const defaultMode = effectiveApplyMode({ kind: "git_remote", url: url.trim() });
  const selected = value || defaultMode;

  // FC5 · đang chọn pr/auto_merge mà host không còn hỗ trợ ⇒ về branch_only.
  useEffect(() => {
    if (!supported && (value === "pr" || value === "auto_merge")) onChange("branch_only");
  }, [supported, value, onChange]);

  return (
    <div className="space-y-1.5">
      <Label id={`${id}-label`}>{t("process.sources.applyMode.label")}</Label>
      <RadioGroup
        aria-label={t("process.sources.applyMode.label")}
        value={selected}
        onValueChange={(v) => onChange(v as ApplyMode)}
        className="gap-2"
      >
        {MODES.map((m) => {
          const dis = NEEDS_PROVIDER(m) && !supported;
          const itemId = `${id}-${m}`;
          const titleId = `${itemId}-title`;
          return (
            <div key={m} className="flex items-start gap-2 rounded-md border border-border p-2.5">
              <RadioGroupItem
                id={itemId}
                value={m}
                disabled={dis}
                aria-labelledby={titleId}
                className="mt-0.5"
              />
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <Label id={titleId} htmlFor={itemId} className="font-normal">
                    {t(`process.sources.applyMode.${m}`)}
                  </Label>
                  {m === defaultMode ? (
                    <Badge variant="info">{t("process.sources.applyMode.default")}</Badge>
                  ) : null}
                </div>
                <p className="text-caption text-muted-foreground">
                  {t(`process.sources.applyMode.${m}.hint`)}
                </p>
              </div>
            </div>
          );
        })}
      </RadioGroup>
      {!supported ? (
        <p className="text-caption text-muted-foreground">
          {t("process.sources.applyMode.hostHint")}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
