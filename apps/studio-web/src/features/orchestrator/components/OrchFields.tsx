// HUB-FR-62 · H4a-R07 · các ô chung của form Orchestrator (bản mặc định và Sheet bản tenant).
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { RadioGroup, RadioGroupItem } from "#/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import type { AgentOption, OrchDraft, OrchErrors, OrchField } from "../lib/draft";

type FrameProps = { id: string; label: string; error?: string; children: ReactNode };

/** Khung một trường: nhãn + ô + câu lỗi (`aria-invalid`/`aria-describedby` do ô con gắn bằng `fieldProps`). */
export function OrchFieldFrame({ id, label, error, children }: FrameProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-err`} className="text-label text-danger">
          {t(error)}
        </p>
      ) : null}
    </div>
  );
}

export const fieldProps = (id: string, error?: string) =>
  error ? ({ id, "aria-invalid": true, "aria-describedby": `${id}-err` } as const) : { id };

type Props = {
  idp: string;
  draft: OrchDraft;
  set: <K extends keyof OrchDraft>(k: K, v: OrchDraft[K]) => void;
  errors: OrchErrors;
  options: AgentOption[];
};

const NUMBERS = [
  ["maxSteps", "max_steps", "maxSteps"],
  ["tokenBudget", "token_budget", "tokenBudget"],
  ["historyN", "history_n", "historyN"],
] as const satisfies readonly (readonly [keyof OrchDraft, OrchField, string])[];

export function OrchFields({ idp, draft, set, errors, options }: Props) {
  const { t } = useTranslation();
  const selected = options.find((o) => o.id === draft.agentId);
  return (
    <div className="space-y-4">
      <OrchFieldFrame id={`${idp}-agent`} label={t("orch.field.agent")} error={errors.agent_id}>
        <Select value={draft.agentId} onValueChange={(v) => set("agentId", v)}>
          <SelectTrigger {...fieldProps(`${idp}-agent`, errors.agent_id)} className="w-full">
            <SelectValue>{selected?.label ?? null}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </OrchFieldFrame>
      {NUMBERS.map(([k, ek, label]) => (
        <OrchFieldFrame
          key={k}
          id={`${idp}-${k}`}
          label={t(`orch.field.${label}`)}
          error={errors[ek]}
        >
          <Input
            {...fieldProps(`${idp}-${k}`, errors[ek])}
            type="number"
            inputMode="numeric"
            value={draft[k]}
            onChange={(e) => set(k, e.target.value)}
          />
        </OrchFieldFrame>
      ))}
      <div className="space-y-1.5">
        <p id={`${idp}-nomatch`} className="text-label font-medium">
          {t("orch.field.onNoMatch")}
        </p>
        <RadioGroup
          aria-labelledby={`${idp}-nomatch`}
          value={draft.onNoMatch}
          onValueChange={(v) => set("onNoMatch", v === "ask" ? "ask" : "answer")}
        >
          {(["answer", "ask"] as const).map((v) => (
            <div key={v} className="flex items-center gap-2">
              <RadioGroupItem id={`${idp}-nomatch-${v}`} value={v} />
              <Label htmlFor={`${idp}-nomatch-${v}`}>{t(`orch.noMatch.${v}`)}</Label>
            </div>
          ))}
        </RadioGroup>
      </div>
    </div>
  );
}
