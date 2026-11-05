// CR-121 D-6b: trường của bước "Thông báo" (người nhận theo vai/phòng, chuông ± mail, tiêu đề + nội dung có biến) và "Chờ tới"
// (ngày của HĐ ± số ngày, giờ) trong Form quy trình thư viện. Lỗi hiện theo mã server (`err.NOTIFY_*` / `WAIT_OFFSET_RANGE`).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  type LibNotifyStep,
  type LibWaitStep,
  NOTIFY_VARS,
  WAIT_OFFSET,
} from "../../lib/flow-form";
import { SelectField, TextField } from "../editor/Fields";
import type { StepFieldProps } from "./flow-step-props";
import { GroupKeyField } from "./GroupKeyField";

const withVar = (text: string, v: string): string => `${text}{${v}}`;

export function NotifyFields({ id, step, groups, err, onPatch }: StepFieldProps<LibNotifyStep>) {
  const { t } = useTranslation();
  const f = (k: string, o?: Record<string, string | number>) =>
    t(`process.admin.library.form.${k}`, o);
  // biến chèn vào ô đang đứng (tiêu đề hoặc nội dung)
  const [target, setTarget] = useState<"title" | "body">("body");
  const email = step.channels.includes("email");
  return (
    <div className="grid gap-3 md:grid-cols-2" data-testid={`${id}-notify`}>
      <TextField
        id={`${id}-name`}
        label={f("name")}
        value={step.name}
        error={err("name")}
        onChange={(name) => onPatch({ name })}
      />
      <fieldset className="space-y-1.5 border-0 p-0" aria-describedby={`${id}-to-err`}>
        <legend className="text-label font-medium">{f("notify.to")}</legend>
        <Label className="flex items-center gap-2 font-normal">
          <Checkbox
            checked={step.to.creator}
            onCheckedChange={(v) => onPatch({ to: { ...step.to, creator: v === true } })}
          />
          {f("notify.toCreator")}
        </Label>
        <Label className="flex items-center gap-2 font-normal">
          <Checkbox
            checked={step.to.owner}
            onCheckedChange={(v) => onPatch({ to: { ...step.to, owner: v === true } })}
          />
          {f("notify.toOwner")}
        </Label>
        {err("to") ? (
          <p id={`${id}-to-err`} role="alert" className="text-label text-destructive">
            {err("to")}
          </p>
        ) : null}
      </fieldset>
      <GroupKeyField
        id={`${id}-group`}
        label={f("notify.toGroup")}
        value={step.to.group_key}
        options={groups}
        placeholder="pb-ke-toan"
        onChange={(group_key) => onPatch({ to: { ...step.to, group_key } })}
      />
      <fieldset className="space-y-1.5 border-0 p-0">
        <legend className="text-label font-medium">{f("notify.channels")}</legend>
        <Label className="flex items-center gap-2 font-normal">
          <Checkbox checked disabled aria-label={f("notify.bell")} />
          {f("notify.bell")}
        </Label>
        <Label className="flex items-center gap-2 font-normal">
          <Checkbox
            checked={email}
            onCheckedChange={(v) =>
              onPatch({ channels: v === true ? ["bell", "email"] : ["bell"] })
            }
          />
          {f("notify.email")}
        </Label>
        {err("channels") ? (
          <p role="alert" className="text-label text-destructive">
            {err("channels")}
          </p>
        ) : null}
      </fieldset>
      <div
        className="space-y-3 md:col-span-2"
        onFocusCapture={(e) => {
          const fid = (e.target as HTMLElement).id;
          if (fid === `${id}-title`) setTarget("title");
          else if (fid === `${id}-body`) setTarget("body");
        }}
      >
        <TextField
          id={`${id}-title`}
          label={f("notify.title")}
          value={step.title}
          error={err("title")}
          maxLength={200}
          onChange={(title) => onPatch({ title })}
        />
        <TextField
          id={`${id}-body`}
          label={f("notify.body")}
          value={step.body}
          multiline
          rows={3}
          maxLength={2000}
          onChange={(body) => onPatch({ body })}
        />
        <fieldset className="m-0 flex flex-wrap items-center gap-1.5 border-0 p-0">
          <legend className="sr-only">{f("notify.vars")}</legend>
          <span aria-hidden className="text-caption text-muted-foreground">
            {f("notify.vars")}
          </span>
          {NOTIFY_VARS.map((v) => (
            <Button
              key={v}
              type="button"
              variant="outline"
              size="sm"
              title={f(`notify.var.${v}`)}
              data-testid={`${id}-var-${v}`}
              onClick={() =>
                onPatch(
                  target === "title"
                    ? { title: withVar(step.title, v) }
                    : { body: withVar(step.body, v) },
                )
              }
            >
              {f(`notify.var.${v}`)}
            </Button>
          ))}
        </fieldset>
      </div>
    </div>
  );
}

export function WaitFields({
  id,
  step,
  err,
  onPatch,
}: Omit<StepFieldProps<LibWaitStep>, "groups">) {
  const { t } = useTranslation();
  const f = (k: string, o?: Record<string, string | number>) =>
    t(`process.admin.library.form.${k}`, o);
  return (
    <div className="grid gap-3 md:grid-cols-2" data-testid={`${id}-wait`}>
      <TextField
        id={`${id}-name`}
        label={f("name")}
        value={step.name}
        error={err("name")}
        onChange={(name) => onPatch({ name })}
      />
      <SelectField
        id={`${id}-from`}
        label={f("wait.from")}
        value={step.from}
        options={[
          { value: "end_date", label: f("wait.endDate") },
          { value: "action_deadline", label: f("wait.actionDeadline") },
        ]}
        onChange={(v) =>
          onPatch({ from: v === "action_deadline" ? "action_deadline" : "end_date" })
        }
      />
      <TextField
        id={`${id}-offset`}
        label={f("wait.offset", WAIT_OFFSET)}
        type="number"
        value={String(step.offset_days)}
        error={err("offset_days")}
        description={f("wait.offsetHint")}
        onChange={(v) => onPatch({ offset_days: v.trim() === "" ? Number.NaN : Number(v) })}
      />
      <TextField
        id={`${id}-time`}
        label={f("wait.time")}
        type="time"
        value={step.time}
        error={err("time")}
        onChange={(time) => onPatch({ time })}
      />
    </div>
  );
}
