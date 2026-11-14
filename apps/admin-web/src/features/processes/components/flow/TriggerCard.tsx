// CR-122 · U1 · FLOW2-FR-02/16: node "Bắt đầu khi" — luôn là node đầu của flow: chọn sự kiện app khai + điều kiện trên dữ kiện của sự kiện.
import type { FlowTrigger } from "@ai/contracts/hub-admin";
import { Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAgentUserOptions } from "@/features/agents/api";
import { eventsOfApp } from "../../lib/flow-def";
import { FactWhenEditor } from "./FactWhenEditor";

type Props = {
  app: string;
  trigger: FlowTrigger;
  readOnly: boolean;
  onEvent: (key: string) => void;
  onWhen: (w: FlowTrigger["when"] | null) => void;
  /** CR-127 · M16 · sự kiện theo lịch: số ngày N (`trigger.params.days`); `null` = để trống. */
  onDays?: (n: number | null) => void;
  /** CR-146b · quy trình «Nhận HĐ từ đối tác»: ngưỡng «Quan trọng»/«Rất quan trọng» (triệu đồng) + người phụ trách (`trigger.params`). */
  onParams?: (p: NonNullable<FlowTrigger["params"]>) => void;
  tenantId?: string | undefined;
  error?: string | undefined;
  /** CR-125 · bắt đầu bằng phiếu yêu cầu: bật ⇒ thêm node «Phiếu yêu cầu» ở đầu flow; tắt ⇒ gỡ. */
  startForm?: { on: boolean; onChange: (on: boolean) => void; error?: string | undefined };
};

export function TriggerCard({
  app,
  trigger,
  readOnly,
  onEvent,
  onWhen,
  onDays,
  onParams,
  tenantId,
  error,
  startForm,
}: Props) {
  const { t } = useTranslation();
  const events = eventsOfApp(app);
  const ev = events.find((e) => e.key === trigger.event);
  return (
    <section
      className="space-y-3 rounded-md border border-border bg-card p-3"
      aria-label={t("process.admin.flow.trigger")}
      data-testid="flow-trigger"
    >
      <div className="grid grid-cols-[8rem_minmax(0,22rem)] items-center gap-2">
        <h3 className="flex items-center gap-2 text-body font-medium">
          <Play aria-hidden className="size-4 text-primary" />
          {t("process.admin.flow.trigger")}
        </h3>
        <Select value={trigger.event || undefined} disabled={readOnly} onValueChange={onEvent}>
          <SelectTrigger
            aria-label={t("process.admin.flow.event")}
            data-testid="flow-trigger-event"
          >
            <SelectValue placeholder={t("process.admin.flow.eventPh")} />
          </SelectTrigger>
          <SelectContent>
            {events.map((e) => (
              <SelectItem key={e.key} value={e.key}>
                {e.label}
              </SelectItem>
            ))}
            {ev || !trigger.event ? null : (
              <SelectItem value={trigger.event}>{trigger.event}</SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>
      {ev?.schedule && onDays ? (
        <ScheduleDays ev={ev} trigger={trigger} readOnly={readOnly} onDays={onDays} />
      ) : null}
      {trigger.event === "contract.received" && onParams ? (
        <ReceiveParams
          trigger={trigger}
          readOnly={readOnly}
          onParams={onParams}
          tenantId={tenantId}
        />
      ) : null}
      {ev ? (
        <div className="grid grid-cols-[8rem_minmax(0,1fr)] items-start gap-2">
          <span className="pt-2 text-caption text-muted-foreground">
            {t("process.admin.flow.onlyWhen")}
          </span>
          <FactWhenEditor
            id="trigger"
            when={trigger.when}
            facts={ev.facts}
            disabled={readOnly}
            onChange={onWhen}
          />
        </div>
      ) : null}
      {startForm ? (
        <div className="space-y-1" data-testid="flow-start-form-toggle">
          <Label className="flex items-center gap-2 font-normal">
            <Checkbox
              checked={startForm.on}
              disabled={readOnly}
              onCheckedChange={(v) => startForm.onChange(v === true)}
            />
            {t("process.admin.startForm.toggle")}
          </Label>
          <p className="text-caption text-muted-foreground">
            {t("process.admin.startForm.toggleHelp")}
          </p>
          {startForm.error ? (
            <p role="alert" className="text-caption text-destructive">
              {startForm.error}
            </p>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** CR-127 · M16 · ô N ngày của sự kiện theo lịch (nhãn lấy từ dữ kiện cùng khoá; khoảng cho phép theo khai báo của sự kiện). */
function ScheduleDays(p: {
  ev: NonNullable<ReturnType<typeof eventsOfApp>[number]>;
  trigger: FlowTrigger;
  readOnly: boolean;
  onDays: (n: number | null) => void;
}) {
  const { t } = useTranslation();
  const sch = p.ev.schedule as {
    param: { key: string; min: number; max: number; default: number };
  };
  const { min, max } = sch.param;
  const label =
    p.ev.facts.find((f) => f.key === sch.param.key)?.label ?? t("process.admin.flow.scheduleDays");
  const days = p.trigger.params?.days;
  const bad = days === undefined || !Number.isInteger(days) || days < min || days > max;
  return (
    <div
      className="grid grid-cols-[8rem_minmax(0,1fr)] items-start gap-2"
      data-testid="flow-trigger-days"
    >
      <span className="pt-2 text-caption text-muted-foreground">{label}</span>
      <div className="space-y-1">
        <Input
          type="number"
          min={min}
          max={max}
          className="w-28"
          aria-label={label}
          aria-invalid={bad}
          disabled={p.readOnly}
          value={days ?? ""}
          onChange={(e) => p.onDays(e.target.value.trim() === "" ? null : Number(e.target.value))}
        />
        {bad ? (
          <p role="alert" className="text-caption text-destructive">
            {t("process.admin.flow.scheduleDaysRange", { min, max })}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** CR-146b · 3 ô của quy trình Nhận HĐ: Quan trọng từ, Rất quan trọng từ (triệu đồng), Người phụ trách hợp đồng nhận. Trống ⇒ mặc định 500 / 2.000 triệu, quản trị phụ trách. */
function ReceiveParams(p: {
  trigger: FlowTrigger;
  readOnly: boolean;
  onParams: (x: NonNullable<FlowTrigger["params"]>) => void;
  tenantId: string | undefined;
}) {
  const { t } = useTranslation();
  const users = useAgentUserOptions(
    p.tenantId,
    !p.readOnly || p.trigger.params?.owner_user_id !== undefined,
  );
  const cur = p.trigger.params ?? {};
  const set = (k: "important_min_m" | "critical_min_m", v: string) => {
    const { [k]: _drop, ...rest } = cur;
    p.onParams(v.trim() === "" ? rest : { ...rest, [k]: Number(v) });
  };
  const bad =
    cur.important_min_m !== undefined &&
    cur.critical_min_m !== undefined &&
    cur.critical_min_m <= cur.important_min_m;
  const num = (k: "important_min_m" | "critical_min_m", label: string, id: string) => (
    <div className="grid grid-cols-[12rem_minmax(0,1fr)] items-center gap-2">
      <Label htmlFor={id} className="text-caption font-normal text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        min={0}
        className="w-36"
        disabled={p.readOnly}
        aria-invalid={bad && k === "critical_min_m"}
        value={cur[k] ?? ""}
        onChange={(e) => set(k, e.target.value)}
      />
    </div>
  );
  return (
    <div className="space-y-2" data-testid="flow-receive-params">
      {num("important_min_m", t("process.admin.flow.receive.important"), "recv-important")}
      {num("critical_min_m", t("process.admin.flow.receive.critical"), "recv-critical")}
      {bad ? (
        <p role="alert" className="text-caption text-destructive">
          {t("process.admin.flow.receive.range")}
        </p>
      ) : null}
      <div className="grid grid-cols-[12rem_minmax(0,22rem)] items-center gap-2">
        <span className="text-caption text-muted-foreground">
          {t("process.admin.flow.receive.owner")}
        </span>
        <Select
          value={cur.owner_user_id ?? "none"}
          disabled={p.readOnly}
          onValueChange={(v) => {
            const { owner_user_id: _o, ...rest } = cur;
            p.onParams(v === "none" ? rest : { ...rest, owner_user_id: v });
          }}
        >
          <SelectTrigger
            aria-label={t("process.admin.flow.receive.owner")}
            data-testid="recv-owner"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t("process.admin.flow.receive.ownerNone")}</SelectItem>
            {(users.data ?? []).map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.name || u.username}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
