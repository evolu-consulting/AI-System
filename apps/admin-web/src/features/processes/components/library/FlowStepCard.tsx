// CR-105 · L3: một bước của Form (duyệt / Ký số / Dify) — chuyển từ contracts-web `FlowStepCard`. Phòng ban theo mã.
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  type FlowIssue,
  issueOf,
  type LibReviewStep,
  type LibStep,
  REMIND_MAX,
  REMIND_MIN,
} from "../../lib/flow-form";
import { TextField } from "../editor/Fields";
import { FlowEsignFields } from "./FlowEsignFields";
import { FlowWhenEditor } from "./FlowWhenEditor";
import { GroupKeyField } from "./GroupKeyField";

export type GroupOption = { key: string; label?: string };
export type StepFieldProps<S> = {
  id: string;
  step: S;
  groups: readonly GroupOption[];
  err: (field: string) => string | undefined;
  onPatch: (p: Partial<S>) => void;
};

type Props = {
  step: LibStep;
  index: number;
  count: number;
  groups: readonly GroupOption[];
  issues: readonly FlowIssue[];
  editable: boolean;
  onPatch: (p: Partial<LibStep>) => void;
  onWhen: (w: LibReviewStep["when"]) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
};

function ReviewFields({
  id,
  step,
  groups,
  err,
  onPatch,
  first,
  onWhen,
}: StepFieldProps<LibReviewStep> & { first: boolean; onWhen: Props["onWhen"] }) {
  const { t } = useTranslation();
  const f = (k: string, o?: Record<string, string | number>) =>
    t(`process.admin.library.form.${k}`, o);
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <TextField
        id={`${id}-name`}
        label={f("name")}
        value={step.name}
        error={err("name")}
        onChange={(name) => onPatch({ name })}
      />
      <GroupKeyField
        id={`${id}-dept`}
        label={f("dept")}
        value={step.department_group_key}
        options={groups}
        placeholder="pb-ke-toan"
        error={err("department_group_key")}
        onChange={(v) => onPatch({ department_group_key: v })}
      />
      <TextField
        id={`${id}-due`}
        label={f("dueH")}
        type="number"
        value={String(step.due_h)}
        error={err("due_h")}
        onChange={(v) => onPatch({ due_h: Number(v) })}
      />
      <TextField
        id={`${id}-remind`}
        label={f("remindHRange", { min: REMIND_MIN, max: REMIND_MAX })}
        type="number"
        value={step.remind_every_h === null ? "" : String(step.remind_every_h)}
        placeholder={f("none")}
        error={err("remind_every_h")}
        onChange={(v) => onPatch({ remind_every_h: v === "" ? null : Number(v) })}
      />
      <GroupKeyField
        id={`${id}-escalate`}
        label={f("escalate")}
        value={step.escalate_group_key}
        options={groups}
        error={err("escalate_group_key")}
        onChange={(v) => onPatch({ escalate_group_key: v })}
      />
      <div className="flex flex-col justify-end gap-2">
        <Label className="flex items-center gap-2 font-normal">
          <Checkbox
            checked={step.head_only}
            onCheckedChange={(v) => onPatch({ head_only: v === true })}
          />
          {f("headOnly")}
        </Label>
        <Label className="flex items-center gap-2 font-normal">
          <Checkbox
            checked={step.exclude_starter}
            onCheckedChange={(v) => onPatch({ exclude_starter: v === true })}
          />
          {f("excludeStarter")}
        </Label>
      </div>
      <div className="space-y-1.5 md:col-span-2">
        <span className="text-label font-medium">{f("cond")}</span>
        {first ? (
          <p className="text-body text-muted-foreground">{f("firstNoCond")}</p>
        ) : (
          <FlowWhenEditor id={id} when={step.when} onChange={onWhen} error={err("when")} />
        )}
      </div>
    </div>
  );
}

export function FlowStepCard(p: Props) {
  const { t } = useTranslation();
  const f = (k: string, o?: Record<string, string | number>) =>
    t(`process.admin.library.form.${k}`, o);
  const { step, index } = p;
  const id = `flow-step-${index}`;
  const first = index === 0;
  const err = (field: string) => {
    const i = issueOf(p.issues, index, field);
    return i ? f(`err.${i.code}`, { min: REMIND_MIN, max: REMIND_MAX }) : undefined;
  };
  const common = { id, groups: p.groups, err };
  const btn = (label: string, icon: React.ReactNode, onClick: () => void, disabled = false) => (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
    </Button>
  );
  const movable = p.editable && !first && step.kind !== "esign";
  return (
    <li className="space-y-3 rounded-md border border-border bg-card p-4" data-testid={id}>
      <div className="flex items-center gap-2">
        <b className="text-label">
          {index + 1}. {first ? f("firstName") : f(`${step.kind}Step`)}
        </b>
        <span className="ml-auto flex gap-1">
          {movable
            ? btn(
                f("up"),
                <ArrowUp aria-hidden className="size-4" />,
                () => p.onMove(-1),
                index <= 1,
              )
            : null}
          {movable
            ? btn(
                f("down"),
                <ArrowDown aria-hidden className="size-4" />,
                () => p.onMove(1),
                index >= p.count - 1,
              )
            : null}
          {p.editable && !first
            ? btn(f("remove"), <Trash2 aria-hidden className="size-4" />, p.onRemove)
            : null}
        </span>
      </div>
      {step.kind === "review" ? (
        <ReviewFields {...common} step={step} first={first} onWhen={p.onWhen} onPatch={p.onPatch} />
      ) : step.kind === "esign" ? (
        <FlowEsignFields {...common} step={step} onPatch={p.onPatch} />
      ) : (
        <div className="space-y-1 text-body">
          <p className="text-muted-foreground">
            {f("difyInfo", { name: step.name || step.workflow_key })}
          </p>
          <p className="text-caption text-muted-foreground">{f("difyCanvas")}</p>
        </div>
      )}
    </li>
  );
}
