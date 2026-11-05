// CR-120 · G3/G4 · khối stage "Chờ N giờ" / "Chờ sự kiện": số giờ hoặc khoá sự kiện + hạn; "Sau giai đoạn" cố định = tự chạy tiếp.
import { useTranslation } from "react-i18next";
import { TextField } from "./Fields";
import type { StageFormProps } from "./stage-form-props";

const K = "process.admin.editor.stage.timedWait.";

export function StageTimedWait(p: StageFormProps) {
  const { t } = useTranslation();
  const { stage, index, errors, readOnly, onChange } = p;
  const w = stage.wait;
  const set = (patch: Partial<typeof w>) => onChange({ wait: { ...w, ...patch } });
  const err = (f: string) => {
    const k = errors[`stages.${index}.executor.${f}`];
    return k ? t(k) : undefined;
  };
  return (
    <fieldset aria-label={t(`${K}hours`)} className="space-y-3" data-testid="stage-timed-wait">
      {stage.executor === "wait_for" ? (
        <TextField
          id={`${stage.uid}-wf-hours`}
          label={t(`${K}hours`)}
          type="number"
          value={w.hours ?? ""}
          min={1}
          max={8760}
          readOnly={readOnly}
          alert
          error={err("hours")}
          onChange={(v) => set({ hours: v })}
        />
      ) : (
        <>
          <TextField
            id={`${stage.uid}-we-event`}
            label={t(`${K}event`)}
            value={w.event ?? ""}
            readOnly={readOnly}
            mono
            alert
            error={err("event")}
            onChange={(v) => set({ event: v })}
          />
          <p className="text-caption text-muted-foreground">{t(`${K}eventHint`)}</p>
          <TextField
            id={`${stage.uid}-we-timeout`}
            label={t(`${K}timeoutH`)}
            type="number"
            value={w.timeoutH ?? ""}
            min={1}
            max={8760}
            readOnly={readOnly}
            alert
            error={err("timeout_h")}
            onChange={(v) => set({ timeoutH: v })}
          />
          <p className="text-caption text-muted-foreground">{t(`${K}timeoutHint`)}</p>
        </>
      )}
    </fieldset>
  );
}
