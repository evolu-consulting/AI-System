// CR-121 c11 · chip bước đánh số (tên bước ở tooltip) + "· N bước", theo artboard CompanyFlows.
import { useTranslation } from "react-i18next";
import type { StepRow } from "@/features/apps/lib/flow-view";

const MAX_CHIPS = 12;

export function StepChips({ steps }: { steps: readonly StepRow[] | null }) {
  const { t } = useTranslation();
  if (!steps || steps.length === 0) return null;
  const shown = steps.slice(0, MAX_CHIPS);
  return (
    <span
      role="img"
      aria-label={t("tenants.flows.steps", { n: steps.length })}
      className="flex flex-wrap items-center gap-1"
    >
      {shown.map((s) => (
        <span
          key={s.key}
          title={s.name}
          className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1 text-caption text-muted-foreground"
        >
          {s.index}
        </span>
      ))}
      {steps.length > MAX_CHIPS ? <span className="text-caption">…</span> : null}
    </span>
  );
}
