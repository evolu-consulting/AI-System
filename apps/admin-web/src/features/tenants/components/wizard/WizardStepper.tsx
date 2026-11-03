// CR-112 · ADM-FR-79 · thanh bước của wizard onboard: danh sách có thứ tự, bước hiện tại có aria-current="step".
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { stepStates, WIZARD_STEPS, type WizardStep } from "../../lib/wizard";

export function WizardStepper({ current }: { current: WizardStep }) {
  const { t } = useTranslation();
  const states = stepStates(current);
  return (
    <nav aria-label={t("tenants.wizard.stepsLabel")} className="mb-6">
      <ol className="flex flex-wrap gap-2">
        {WIZARD_STEPS.map((s, i) => {
          const state = states[i];
          return (
            <li
              key={s}
              aria-current={state === "current" ? "step" : undefined}
              data-state={state}
              className={cn(
                "flex items-center gap-2 rounded-md border px-3 py-2 text-label",
                state === "current" && "border-primary bg-primary/5 font-semibold text-foreground",
                state === "done" && "border-border text-foreground",
                state === "todo" && "border-border text-muted-foreground",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "flex size-5 items-center justify-center rounded-full border text-caption",
                  state === "current" && "border-primary bg-primary text-primary-foreground",
                  state === "done" && "border-primary text-primary",
                )}
              >
                {state === "done" ? <Check className="size-3" /> : i + 1}
              </span>
              {t(`tenants.wizard.step.${s}`)}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
