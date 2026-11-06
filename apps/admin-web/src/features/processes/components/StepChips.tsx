// CR-121 c15 · MỘT component chip bước cho Thư viện quy trình và Công ty › Quy trình: chip = TÊN bước nối bằng mũi tên, cắt + "+N".
import { useTranslation } from "react-i18next";
import { splitChips } from "../lib/step-chips";

export type ChipStep = { key: string; name: string; index: number };

export function StepChips({
  steps,
  count,
}: {
  steps: readonly ChipStep[] | null;
  /** Không có tên bước nhưng biết số bước ⇒ viên trung tính "N bước" (cùng kiểu chip, không số trơn). */
  count?: number;
}) {
  const { t } = useTranslation();
  if ((!steps || steps.length === 0) && count && count > 0)
    return (
      <span
        className="inline-flex whitespace-nowrap rounded-full border border-border bg-muted px-2 text-caption text-muted-foreground"
        data-testid="steps-count"
      >
        {t("process.admin.library.stepsCount", { n: count })}
      </span>
    );
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
            className="whitespace-nowrap rounded-full border border-border bg-muted px-2 text-caption text-muted-foreground"
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
