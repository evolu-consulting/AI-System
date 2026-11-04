// dlc-engine · form một BƯỚC DLC trên Canvas của quy trình thư viện (khe `dlc.*`): tên, việc, agent (Agent Hub, theo khoá), lời
// dặn, cổng duyệt (Group theo mã + được quay lại bước nào), số vòng, hạn. Sửa vào `stage.slotRaw` (+ `name`); Lưu ⇒ Hub `fromStages`
// dựng lại `slot_body` rồi biên dịch. Bước khác loại trong cùng sơ đồ ⇒ báo KIND_MIX (không nối được, không lưu được).
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  DLC_ACTIONS,
  DLC_DEFAULT_AGENT,
  DLC_GROUP_EDITOR,
  type DlcSlot,
  dlcDraftErrors,
  dlcOf,
  dlcUsesAgent,
  dlcUsesRounds,
  isDlcStep,
} from "../../lib/dlc-slot";
import type { StageDraft } from "../../lib/draft-types";
import { SelectField, TextField } from "../editor/Fields";
import type { GroupOption } from "./flow-step-props";
import { GroupKeyField } from "./GroupKeyField";

type Props = {
  stage: StageDraft;
  index: number;
  all: readonly StageDraft[];
  groups: readonly GroupOption[];
  agents: readonly { key: string; label?: string }[];
  onChange: (patch: Partial<StageDraft>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
};

/** Các bước DLC đứng trước (đích "quay lại" của cổng duyệt). */
const earlierSteps = (all: readonly StageDraft[], index: number) =>
  all
    .slice(0, index)
    .filter(isDlcStep)
    .map((s) => ({ key: dlcOf(s).key || s.key, name: s.name }));

function GateFields(p: {
  id: string;
  d: DlcSlot;
  earlier: { key: string; name: string }[];
  groups: readonly GroupOption[];
  err: (f: string) => string | undefined;
  set: (patch: Partial<DlcSlot>) => void;
}) {
  const { t } = useTranslation();
  const f = (k: string) => t(`process.admin.library.dlc.${k}`);
  const g = p.d.gate;
  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="flex items-center gap-2">
        <Switch
          id={`${p.id}-gate`}
          checked={g !== null}
          onCheckedChange={(on) =>
            p.set({ gate: on ? { group_key: DLC_GROUP_EDITOR, back_to: [] } : null })
          }
        />
        <Label htmlFor={`${p.id}-gate`}>{f("gate")}</Label>
      </div>
      {g ? (
        <>
          <GroupKeyField
            id={`${p.id}-group`}
            label={f("gateGroup")}
            value={g.group_key}
            options={p.groups}
            error={p.err("gate")}
            onChange={(v) => p.set({ gate: { ...g, group_key: v ?? "" } })}
          />
          <p className="text-caption text-muted-foreground">{f("approveNext")}</p>
          <fieldset className="space-y-1.5">
            <legend className="text-label font-medium">{f("backTo")}</legend>
            {p.earlier.length === 0 ? (
              <p className="text-caption text-muted-foreground">{f("backToNone")}</p>
            ) : (
              p.earlier.map((e) => {
                const id = `${p.id}-back-${e.key}`;
                const on = g.back_to.includes(e.key);
                return (
                  <div key={e.key} className="flex items-center gap-2">
                    <Checkbox
                      id={id}
                      checked={on}
                      onCheckedChange={(c) =>
                        p.set({
                          gate: {
                            ...g,
                            back_to: c
                              ? [...g.back_to, e.key]
                              : g.back_to.filter((k) => k !== e.key),
                          },
                        })
                      }
                    />
                    <Label htmlFor={id}>{e.name || e.key}</Label>
                  </div>
                );
              })
            )}
            <p className="text-caption text-muted-foreground">{f("rejectHint")}</p>
            {p.err("back_to") ? (
              <p className="text-caption text-destructive">{p.err("back_to")}</p>
            ) : null}
          </fieldset>
        </>
      ) : (
        <p className="text-caption text-muted-foreground">{f("gateOffHint")}</p>
      )}
    </div>
  );
}

export function DlcStageForm({
  stage,
  index,
  all,
  groups,
  agents,
  onChange,
  onMove,
  onRemove,
}: Props) {
  const { t } = useTranslation();
  const f = (k: string, o?: Record<string, string | number>) =>
    t(`process.admin.library.dlc.${k}`, o);
  const d = { ...dlcOf(stage), name: stage.name };
  const errs = dlcDraftErrors(all);
  const err = (field: string) => {
    const k = errs[`stages.${index}.dlc.${field}`];
    return k ? t(k) : undefined;
  };
  const set = (p: Partial<DlcSlot>) => onChange({ slotRaw: { ...dlcOf(stage), ...p } });
  const id = `dlc-${stage.uid}`;
  const actions = DLC_ACTIONS.map((a) => ({ value: a, label: f(`action.${a}`) }));
  const num = (v: string) => (v.trim() === "" ? Number.NaN : Number(v));
  return (
    <div className="space-y-3" data-testid="dlc-stage-form">
      <h3 className="text-label font-semibold">
        {index + 1}. {f("title")}
      </h3>
      {err("kind") ? (
        <p role="alert" className="text-label text-destructive">
          {err("kind")}
        </p>
      ) : null}
      <TextField
        id={`${id}-name`}
        label={t("process.admin.library.form.name")}
        value={stage.name}
        error={err("name")}
        onChange={(name) => onChange({ name, slotRaw: { ...dlcOf(stage), name } })}
      />
      <SelectField
        id={`${id}-action`}
        label={f("actionLabel")}
        value={d.action}
        options={actions}
        error={err("action")}
        description={f(`actionHint.${d.action}`)}
        onChange={(a) => set({ action: a as DlcSlot["action"] })}
      />
      {dlcUsesAgent(d.action) ? (
        <GroupKeyField
          id={`${id}-agent`}
          label={f("agent")}
          value={d.agent_key}
          options={agents}
          error={err("agent_key")}
          placeholder={DLC_DEFAULT_AGENT[d.action] ?? ""}
          onChange={(v) => set({ agent_key: v })}
        />
      ) : null}
      <TextField
        id={`${id}-instruction`}
        label={d.action === "agent" ? f("task") : f("instruction")}
        value={d.instruction ?? ""}
        multiline
        rows={4}
        error={err("instruction")}
        onChange={(instruction) => set({ instruction })}
      />
      <GateFields
        id={id}
        d={d}
        earlier={earlierSteps(all, index)}
        groups={groups}
        err={err}
        set={set}
      />
      <div className="grid grid-cols-2 gap-3">
        {dlcUsesRounds(d.action) ? (
          <TextField
            id={`${id}-rounds`}
            label={f(d.action === "build" ? "roundsBuild" : "roundsVerify")}
            type="number"
            value={String(d.max_rounds)}
            error={err("max_rounds")}
            onChange={(v) => set({ max_rounds: num(v) })}
          />
        ) : null}
        <TextField
          id={`${id}-timeout`}
          label={f("timeout")}
          type="number"
          value={String(d.timeout_min)}
          error={err("timeout_min")}
          onChange={(v) => set({ timeout_min: num(v) })}
        />
      </div>
      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={index <= 0}
          onClick={() => onMove(-1)}
        >
          <ArrowUp aria-hidden className="size-4" />
          {t("process.admin.library.form.up")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={index >= all.length - 1}
          onClick={() => onMove(1)}
        >
          <ArrowDown aria-hidden className="size-4" />
          {t("process.admin.library.form.down")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={all.length <= 1}
          onClick={onRemove}
        >
          <Trash2 aria-hidden className="size-4" />
          {t("process.admin.library.form.remove")}
        </Button>
      </div>
    </div>
  );
}
