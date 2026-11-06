// CR-121 c11 · chip bước theo TÊN bước nối bằng mũi tên ("Pháp chế → Kế toán → Duyệt"), cắt + "+N" khi dài (artboard CompanyFlows).
import { useTranslation } from "react-i18next";
import type { StepRow } from "@/features/apps/lib/flow-view";

const MAX_CHIPS = 4;

export function StepChips({ steps }: { steps: readonly StepRow[] | null }) {
  const { t } = useTranslation();
  if (!steps || steps.length === 0) return null;
  const shown = steps.slice(0, MAX_CHIPS);
  const more = steps.length - shown.length;
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
      {more > 0 ? (
        <span
          className="text-caption text-muted-foreground"
          title={steps
            .slice(MAX_CHIPS)
            .map((s) => s.name)
            .join(" → ")}
        >
          {t("tenants.flows.stepsMore", { n: more })}
        </span>
      ) : null}
    </span>
  );
}
