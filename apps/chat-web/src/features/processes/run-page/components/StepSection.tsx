// CHAT-AC-60 · plan-frontend §4–§5: nhóm theo bước ở trang Run — `group` "Bước n" (+ ×lần khi đã làm lại). Trình bày thuần.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { stepNo } from "../../shared/lib/steps";

export function StepSection({
  step,
  round = 1,
  children,
}: {
  step: number;
  round?: number;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const label = t("process.run.step.title", { n: stepNo(step) });
  return (
    <fieldset
      aria-label={label}
      className="m-0 flex min-w-0 flex-col gap-3 rounded-lg border-l-2 border-border pl-3"
    >
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        {label}
        {round > 1 && (
          <span className="rounded-sm bg-muted px-1.5 text-caption font-medium text-secondary-foreground">
            {t("process.run.step.roundLong", { n: round })}
          </span>
        )}
      </h3>
      {children}
    </fieldset>
  );
}
