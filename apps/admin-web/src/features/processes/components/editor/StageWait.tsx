// ADM-FR-71 · HUB-FR-143 · P-d1 T11b (plan-frontend FD2/§2; mockup A1/A2): khối stage "Chờ tới ngày" — nguồn ngày, chênh lệch,
// giờ, múi giờ, "Sau giai đoạn" cố định. Lỗi: live (cùng luật `waitIssues`) + lỗi server theo path (WAIT_INVALID).
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { waitIssueKey } from "../../domain/error-keys";
import {
  type DateSource,
  dateSources,
  offsetDirection,
  sourceValue,
  waitIssues,
} from "../../domain/wait-rules";
import { withCurrent } from "../../hooks/use-editor-refs";
import type { Translate } from "../../lib/stage-label";
import { waitErrorAt } from "../../lib/wait-form";
import { SelectField, TextField } from "./Fields";
import type { StageFormProps } from "./stage-form-props";
import { WaitTimezone } from "./WaitTimezone";

const K = "process.admin.editor.stage.wait.";

function sourceLabel(t: Translate, s: DateSource): string {
  return s.kind === "input"
    ? t(`${K}fromInput`, { label: s.label })
    : t(`${K}fromField`, { n: s.n, stage: s.stageName, field: s.field });
}

export function StageWait(p: StageFormProps) {
  const { t } = useTranslation();
  const { stage, index, all, errors, readOnly, onChange } = p;
  const w = stage.wait;
  const set = (patch: Partial<typeof w>) => onChange({ wait: { ...w, ...patch } });
  const sources = useMemo(
    () => dateSources(p.defInputs ?? [], all, stage.step),
    [p.defInputs, all, stage.step],
  );
  const live = waitIssues(w, sources);
  const at = (f: string) => errors[`stages.${index}.executor.${f}`];
  const key = (k: string | undefined) => (k ? t(k) : undefined);
  const fromErr =
    waitErrorAt(errors, index) ??
    (live.source === "invalid" && w.source !== "" ? waitIssueKey("source") : undefined);
  const offsetErr = live.offset ? waitIssueKey("offset") : at("offset_days");
  const timeErr = live.time ? waitIssueKey("time") : at("time");
  const options = withCurrent(
    sources.map((s) => ({ value: sourceValue(s), label: sourceLabel((k, o) => t(k, o), s) })),
    w.source,
    t("process.admin.editor.gone"),
  );
  const tzId = `${stage.uid}-wait-tz`;
  const sourceText = options.find((o) => o.value === w.source)?.label ?? "";
  const dir = offsetDirection(live.offset ? 0 : Number(w.offset));
  const noValid = fromErr === undefined && live.time === undefined && live.offset === undefined;
  return (
    <fieldset aria-label={t(`${K}title`)} className="space-y-3" data-testid="stage-wait">
      <div className="flex items-center justify-between gap-2">
        <strong className="text-label font-medium">{t(`${K}title`)}</strong>
        {noValid && w.source !== "" ? <Badge variant="ok">{t(`${K}valid`)}</Badge> : null}
      </div>
      <p className="text-caption text-muted-foreground">{t(`${K}hint`)}</p>
      <SelectField
        id={`${stage.uid}-wait-from`}
        label={t(`${K}from`)}
        value={w.source}
        readOnly={readOnly}
        disabled={sources.length === 0 && w.source === ""}
        alert
        error={key(fromErr)}
        placeholder={t(`${K}fromPh`)}
        options={options}
        onChange={(v) => set({ source: v })}
      />
      {sources.length === 0 && w.source === "" ? (
        <Alert role="status" className="bg-warning-bg">
          <AlertDescription>{t(`${K}fromNone`)}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          id={`${stage.uid}-wait-offset`}
          label={t(`${K}offset`)}
          type="number"
          value={w.offset}
          min={-365}
          max={365}
          readOnly={readOnly}
          alert
          error={key(offsetErr)}
          onChange={(v) => set({ offset: v })}
        />
        <TextField
          id={`${stage.uid}-wait-time`}
          label={t(`${K}time`)}
          type="time"
          value={w.time}
          readOnly={readOnly}
          alert
          error={key(timeErr)}
          describedBy={tzId}
          onChange={(v) => set({ time: v })}
        />
      </div>
      <p className="text-caption text-muted-foreground">{t(`${K}offsetHint`)}</p>
      <WaitTimezone id={tzId} />
      {noValid && sourceText ? (
        <p className="text-caption text-muted-foreground">
          {t(`${K}formula.${dir.dir}`, { count: dir.abs, time: w.time, source: sourceText })}
        </p>
      ) : null}
      <SelectField
        id={`${stage.uid}-after`}
        label={t("process.admin.editor.stage.after")}
        value="auto"
        disabled
        readOnly={readOnly}
        options={[{ value: "auto", label: t(`${K}after`) }]}
        onChange={() => undefined}
      />
    </fieldset>
  );
}
