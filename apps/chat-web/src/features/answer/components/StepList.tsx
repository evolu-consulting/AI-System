// CHAT-AC-08, CHAT-AC-09, CR-054 · danh sách bước: đang chạy (spinner, aria-busy) → Collapsible "✓ n bước · s".
// Bước có agent: "Orchestrator · Haiku — <nhãn>".
import type { StepAgent } from "@ai/contracts/chat";
import { Check, ChevronDown, LoaderCircle, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import { stepAgentPrefix } from "../lib/step-label";

export type StepItem = {
  id: string;
  label: string;
  status: "running" | "ok" | "failed";
  ms: number | null;
  agent?: StepAgent;
};

/** 2100 → "2,1" (vi) / "2.1" (en). */
export function formatSeconds(ms: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(ms / 1000);
}

function StepIcon({ status }: { status: StepItem["status"] }) {
  if (status === "running")
    return (
      <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
    );
  if (status === "ok") return <Check className="size-3.5 text-success" aria-hidden />;
  return <X className="size-3.5 text-danger" aria-hidden />;
}

function StepRow({ step, locale }: { step: StepItem; locale: string }) {
  const running = step.status === "running";
  const prefix = stepAgentPrefix(step.agent);
  return (
    <li
      aria-busy={running ? "true" : undefined}
      className="flex items-center gap-2 text-caption text-muted-foreground"
    >
      <StepIcon status={step.status} />
      <span>
        {prefix ? <span className="font-medium text-foreground">{prefix} — </span> : null}
        {step.label}
      </span>
      {step.ms !== null && !running && <span>{formatSeconds(step.ms, locale)}s</span>}
    </li>
  );
}

export function StepList({ steps, streaming }: { steps: readonly StepItem[]; streaming: boolean }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  if (steps.length === 0) return null;
  const rows = (
    <ul aria-label={t("steps.list")} className="flex flex-col gap-1">
      {steps.map((s) => (
        <StepRow key={s.id} step={s} locale={i18n.language} />
      ))}
    </ul>
  );
  if (streaming || steps.some((s) => s.status === "running")) return rows;
  const total = steps.reduce((sum, s) => sum + (s.ms ?? 0), 0);
  const seconds = formatSeconds(total, i18n.language);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-1 text-caption text-muted-foreground hover:text-foreground">
        <span>✓ {t("steps.summary", { count: steps.length, seconds })}</span>
        <ChevronDown className="size-3.5" aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-1.5">{rows}</CollapsibleContent>
    </Collapsible>
  );
}
