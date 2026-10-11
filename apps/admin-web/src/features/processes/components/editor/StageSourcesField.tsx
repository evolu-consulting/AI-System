// ADM-FR-69 · HUB-FR-125 · P-b FS-8a: nguồn của một giai đoạn — chọn ≤ 5 trong nguồn của quy trình + allowlist (mỗi dòng một glob).
import { STAGE_SOURCES_MAX } from "@ai/contracts/hub-admin";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { DraftErrors, StageDraft } from "../../lib/def-form";
import { TextField } from "./Fields";

type Props = {
  stage: StageDraft;
  index: number;
  /** Nguồn khai báo ở quy trình (`def.sources`). */
  defSources: readonly string[];
  errors: DraftErrors;
  readOnly: boolean;
  onChange: (patch: Partial<StageDraft>) => void;
};

export function StageSourcesField({ stage, index, defSources, errors, readOnly, onChange }: Props) {
  const { t } = useTranslation();
  const chosen = stage.sources;
  const full = chosen.length >= STAGE_SOURCES_MAX;
  const toggle = (key: string, on: boolean) =>
    onChange({
      sources: on ? [...chosen, { key, allowlist: "" }] : chosen.filter((s) => s.key !== key),
    });
  const setAllow = (key: string, allowlist: string) =>
    onChange({ sources: chosen.map((s) => (s.key === key ? { ...s, allowlist } : s)) });
  // Nguồn đã chọn nhưng không còn trong quy trình vẫn hiện để người dùng bỏ tick.
  const keys = [...defSources, ...chosen.map((s) => s.key).filter((k) => !defSources.includes(k))];
  const maxErr = errors[`stages.${index}.sources`];
  return (
    <fieldset className="space-y-3">
      <legend className="text-label font-medium">
        {t("process.admin.editor.stageSources.title")}
      </legend>
      {keys.length === 0 ? (
        <p className="text-caption text-muted-foreground">
          {t("process.admin.editor.stageSources.none")}
        </p>
      ) : null}
      {keys.map((key) => {
        const j = chosen.findIndex((s) => s.key === key);
        const on = j >= 0;
        const id = `${stage.uid}-src-${key}`;
        const refErr = errors[`stages.${index}.sources.${j}.source_key`];
        const globErr = errors[`stages.${index}.sources.${j}.allowlist`];
        return (
          <div key={key} className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id={id}
                checked={on}
                disabled={readOnly || (!on && full)}
                onCheckedChange={(v) => toggle(key, v === true)}
              />
              <Label htmlFor={id} className="font-mono">
                {key}
              </Label>
            </div>
            {refErr ? (
              <p className="text-caption text-destructive">{t(refErr, { n: index + 1 })}</p>
            ) : null}
            {on ? (
              <TextField
                id={`${id}-allow`}
                label={t("process.admin.editor.stageSources.allowlist", { key })}
                description={t("process.admin.editor.stageSources.allowlistHint")}
                value={chosen[j]?.allowlist ?? ""}
                multiline
                rows={3}
                mono
                error={globErr ? t(globErr) : undefined}
                readOnly={readOnly}
                onChange={(v) => setAllow(key, v)}
              />
            ) : null}
          </div>
        );
      })}
      {full ? (
        <p className="text-caption text-muted-foreground">
          {t("process.admin.editor.stageSources.max")}
        </p>
      ) : null}
      {maxErr ? <p className="text-caption text-destructive">{t(maxErr)}</p> : null}
      {chosen.length > 0 ? (
        <Alert role="status">
          <AlertDescription>
            <p>{t("process.admin.editor.stageSources.autoOutput")}</p>
            <p>{t("process.admin.editor.stageSources.budget")}</p>
          </AlertDescription>
        </Alert>
      ) : null}
    </fieldset>
  );
}
