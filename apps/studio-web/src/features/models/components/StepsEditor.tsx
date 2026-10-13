// HUB-FR-67 · D1 · danh sách bước (1–5): thêm / xoá / Lên / Xuống. Bản nháp do ProfileEditor giữ.
import { useTranslation } from "react-i18next";
import { Button } from "#/components/ui/button";
import { blankStep, type DraftErrors, type DraftStep, MAX_STEPS } from "../lib/profile-draft";
import { StepRow } from "./StepRow";

type Props = {
  steps: readonly DraftStep[];
  providers: readonly string[];
  errors: DraftErrors;
  onChange: (steps: DraftStep[]) => void;
};

export function StepsEditor({ steps, providers, errors, onChange }: Props) {
  const { t } = useTranslation();
  const patch = (uid: number, p: Partial<DraftStep>) =>
    onChange(steps.map((s) => (s.uid === uid ? { ...s, ...p } : s)));
  const move = (i: number, by: -1 | 1) => {
    const next = [...steps];
    const [s] = next.splice(i, 1);
    if (s) next.splice(i + by, 0, s);
    onChange(next);
  };
  return (
    <section className="space-y-3">
      <h3 className="text-label font-medium">{t("models.profile.steps")}</h3>
      <ol aria-label={t("models.profile.steps")} className="space-y-3">
        {steps.map((s, i) => (
          <StepRow
            key={s.uid}
            step={s}
            index={i}
            count={steps.length}
            providers={providers}
            error={errors.step[i]}
            onChange={patch}
            onMove={move}
            onRemove={(uid) => onChange(steps.filter((x) => x.uid !== uid))}
          />
        ))}
      </ol>
      {errors.steps ? <p className="text-label text-destructive">{t(errors.steps)}</p> : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={steps.length >= MAX_STEPS}
        onClick={() => onChange([...steps, blankStep()])}
      >
        {t("models.profile.addStep")}
      </Button>
    </section>
  );
}
