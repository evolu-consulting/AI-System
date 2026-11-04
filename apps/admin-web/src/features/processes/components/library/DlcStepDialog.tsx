// dlc-step-library · hộp thoại Thêm/Sửa BƯỚC DLC mẫu: mọi thuộc tính chọn từ danh sách (việc, agent, Group duyệt, "Từ chối ⇒"),
// không gõ JSON. Duyệt luôn sang bước kế tiếp (chỉ hiện chữ). Lỗi ô theo contract; lỗi server (khoá trùng, 409) dưới form.
import { DLC_STEP_ACTIONS, type DlcStepTemplate } from "@ai/contracts/hub-admin";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DLC_DEFAULT_AGENT, dlcUsesAgent, dlcUsesRounds } from "../../lib/dlc-slot";
import {
  blankDlcStep,
  type DlcStepDraft,
  dlcStepErrors,
  draftOf,
  withGate,
  withName,
} from "../../lib/dlc-step-form";
import { type Option, SelectField, TextField } from "../editor/Fields";
import type { GroupOption } from "./flow-step-props";
import { GroupKeyField } from "./GroupKeyField";

const DEFAULT = "__default";
type Props = {
  /** `null` = thêm mới. */
  initial: DlcStepTemplate | null;
  agents: readonly { key: string; label: string }[];
  groups: readonly GroupOption[];
  onClose: () => void;
  /** Trả khoá lỗi (`keyTaken`/`conflict`/`invalid`/`generic`) hoặc `null` khi lưu xong. */
  onSubmit: (d: DlcStepDraft) => Promise<string | null>;
};
type Put = (d: DlcStepDraft) => void;

function GateBlock({
  d,
  set,
  groups,
  err,
}: { d: DlcStepDraft; set: Put } & Pick<Props, "groups"> & {
    err: (f: string) => string | undefined;
  }) {
  const { t } = useTranslation();
  const f = (k: string, o?: Record<string, string>) => t(`process.admin.library.dlc.steps.${k}`, o);
  const a = (x: string) => t(`process.admin.library.dlc.action.${x}`);
  const rejects: Option[] = [
    { value: "self", label: f("reject.self") },
    { value: "prev", label: f("reject.prev") },
    ...DLC_STEP_ACTIONS.map((x) => ({ value: x, label: f("reject.action", { action: a(x) }) })),
  ];
  const on = d.gate_group !== null;
  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="flex items-center gap-2">
        <Switch id="dlc-step-gate" checked={on} onCheckedChange={(c) => set(withGate(d, c))} />
        <Label htmlFor="dlc-step-gate">{f("field.gate")}</Label>
      </div>
      {on ? (
        <>
          <GroupKeyField
            id="dlc-step-group"
            label={f("field.group")}
            value={d.gate_group}
            options={groups}
            error={err("gate_group")}
            onChange={(v) => set({ ...d, gate_group: v ?? "" })}
          />
          <p className="text-caption text-muted-foreground">
            {t("process.admin.library.dlc.approveNext")}
          </p>
          <SelectField
            id="dlc-step-reject"
            label={f("field.reject")}
            value={d.reject_to ?? "self"}
            options={rejects}
            error={err("reject_to")}
            onChange={(v) => set({ ...d, reject_to: v as DlcStepDraft["reject_to"] })}
          />
        </>
      ) : (
        <p className="text-caption text-muted-foreground">
          {t("process.admin.library.dlc.gateOffHint")}
        </p>
      )}
    </div>
  );
}

/** Agent bật (khoá) + "Mặc định của việc này" (trừ việc `agent`) + giá trị đang chọn nhưng đã vắng khỏi danh sách. */
function agentOptions(
  d: DlcStepDraft,
  agents: Props["agents"],
  f: (k: string, o?: Record<string, string>) => string,
): Option[] {
  const dflt = DLC_DEFAULT_AGENT[d.action];
  const head = dflt ? f("field.agentDefault", { agent: dflt }) : f("field.agentNone");
  const gone = d.agent_key && !agents.some((x) => x.key === d.agent_key);
  return [
    ...(d.action === "agent" ? [] : [{ value: DEFAULT, label: head }]),
    ...agents.map((x) => ({ value: x.key, label: `${x.label} (${x.key})` })),
    ...(gone && d.agent_key ? [{ value: d.agent_key, label: d.agent_key }] : []),
  ];
}

export function DlcStepDialog({ initial, agents, groups, onClose, onSubmit }: Props) {
  const { t } = useTranslation();
  const f = (k: string, o?: Record<string, string>) => t(`process.admin.library.dlc.steps.${k}`, o);
  const [d, set] = useState<DlcStepDraft>(() => (initial ? draftOf(initial) : blankDlcStep()));
  const [shown, setShown] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const errs = dlcStepErrors(d);
  const err = (k: string) => (shown && errs[k] ? t(errs[k]) : undefined);
  const actions = DLC_STEP_ACTIONS.map((x) => ({
    value: x,
    label: t(`process.admin.library.dlc.action.${x}`),
  }));
  const agentOpts = agentOptions(d, agents, f);
  const num = (v: string) => (v.trim() === "" ? Number.NaN : Number(v));
  const submit = async () => {
    setShown(true);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setFail(null);
    try {
      const k = await onSubmit(d);
      if (k) setFail(f(`err.${k}`));
      else onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{f(initial ? "edit" : "create")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <TextField
            id="dlc-step-name"
            label={f("field.name")}
            value={d.name}
            error={err("name")}
            onChange={(v) => set(withName(d, v))}
          />
          <TextField
            id="dlc-step-key"
            label={f("field.key")}
            description={f("field.keyHint")}
            mono
            value={d.key}
            error={err("key")}
            onChange={(v) => set({ ...d, key: v.trim().toLowerCase(), keyAuto: false })}
          />
          <SelectField
            id="dlc-step-action"
            label={t("process.admin.library.dlc.actionLabel")}
            value={d.action}
            options={actions}
            description={t(`process.admin.library.dlc.actionHint.${d.action}`)}
            onChange={(v) =>
              set({
                ...d,
                action: v as DlcStepDraft["action"],
                agent_key: dlcUsesAgent(v) ? d.agent_key : null,
              })
            }
          />
          {dlcUsesAgent(d.action) ? (
            <SelectField
              id="dlc-step-agent"
              label={f("field.agent")}
              value={d.agent_key ?? (d.action === "agent" ? "" : DEFAULT)}
              options={agentOpts}
              error={err("agent_key")}
              onChange={(v) => set({ ...d, agent_key: v === DEFAULT ? null : v })}
            />
          ) : null}
          <TextField
            id="dlc-step-instruction"
            label={t(`process.admin.library.dlc.${d.action === "agent" ? "task" : "instruction"}`)}
            value={d.instruction}
            multiline
            rows={4}
            error={err("instruction")}
            onChange={(v) => set({ ...d, instruction: v })}
          />
          <GateBlock d={d} set={set} groups={groups} err={err} />
          <div className="grid grid-cols-2 gap-3">
            {dlcUsesRounds(d.action) ? (
              <TextField
                id="dlc-step-rounds"
                label={t(
                  `process.admin.library.dlc.${d.action === "build" ? "roundsBuild" : "roundsVerify"}`,
                )}
                type="number"
                value={String(d.max_rounds)}
                error={err("max_rounds")}
                onChange={(v) => set({ ...d, max_rounds: num(v) })}
              />
            ) : null}
            <TextField
              id="dlc-step-timeout"
              label={f("field.timeout")}
              type="number"
              value={String(d.timeout_min)}
              error={err("timeout_min")}
              onChange={(v) => set({ ...d, timeout_min: num(v) })}
            />
          </div>
          {fail ? (
            <p role="alert" className="text-label text-destructive">
              {fail}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {f("cancel")}
          </Button>
          <Button disabled={busy} onClick={() => void submit()}>
            {f("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
