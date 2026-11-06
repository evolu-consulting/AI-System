// CR-121 c15 · MỘT component chip bước cho Thư viện quy trình và Công ty › Quy trình: chip = TÊN bước nối bằng mũi tên, cắt + "+N".
import { useTranslation } from "react-i18next";
import { splitChips } from "../lib/step-chips";

export type ChipStep = { key: string; name: string; index: number };

export function StepChips({ steps }: { steps: readonly ChipStep[] | null }) {
  const { t } = useTranslation();
  if (!steps || steps.length === 0) return null;
  const { shown, rest } = splitChips(steps);
  return (
    <span
      role="img"
      aria-label={steps.map((s) => s.name).join(" → ")}
      className="flex min-w-0 flex-wrap items-center gap-1"
    >
      {shown.map((s, i) => (
        <span key={s.key} className="inline-flex min-w-0 items-center gap-1">
          {i > 0 ? (
            <span aria-hidden className="text-caption text-muted-foreground">
              →
            </span>
          ) : null}
          <span
            title={`${s.index}. ${s.name}`}
            className="max-w-32 truncate rounded-full bg-muted px-2 text-caption text-muted-foreground"
          >
            {s.name}
          </span>
        </span>
      ))}
      {rest.length > 0 ? (
        <span
          className="text-caption text-muted-foreground"
          title={rest.map((s) => s.name).join(" → ")}
        >
          {t("tenants.flows.stepsMore", { n: rest.length })}
        </span>
      ) : null}
    </span>
  );
}
