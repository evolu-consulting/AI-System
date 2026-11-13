// CR-125 · cr125-parallel-approval-ui · «A + B cùng duyệt» trên node Duyệt: công tắc «Duyệt cùng lúc nhiều nhóm» → danh sách nhóm (2–5, mỗi nhóm một nhãn
// hiện trên thẻ) → luật Tất cả / Một trong số / Ít nhất N. Bật/tắt giữ nhóm đầu làm «Ai duyệt» của bước một nhóm. Lỗi lưu hiện cạnh ô (path `…after.parallel.*`).
import { Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { withCurrent } from "../../hooks/use-editor-refs";
import {
  emptyParallelGroup,
  PARALLEL_GROUPS,
  PARALLEL_LABEL_MAX,
  type ParallelDraft,
  type ParallelGroupDraft,
  type ParallelRuleKind,
  startParallel,
} from "../../lib/parallel-form";
import { SelectField, TextField } from "./Fields";
import type { StageFormProps } from "./stage-form-props";

const K = "process.admin.parallel.";
const RULES: readonly ParallelRuleKind[] = ["all", "any", "min"];

/** Hàng một nhóm: chọn nhóm (tên) + nhãn hiện trên thẻ; chọn nhóm mới ⇒ nhãn theo tên nhóm nếu chưa gõ nhãn riêng. */
function GroupRow(p: {
  uid: string;
  n: number;
  g: ParallelGroupDraft;
  options: { value: string; label: string }[];
  canRemove: boolean;
  readOnly: boolean;
  onChange: (g: ParallelGroupDraft) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const { g } = p;
  const nameOf = (id: string) => p.options.find((o) => o.value === id)?.label ?? "";
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-start gap-2">
      <SelectField
        id={`${p.uid}-pg${p.n}`}
        label={t(`${K}group`, { n: p.n + 1 })}
        value={g.groupId}
        readOnly={p.readOnly}
        placeholder={t("process.admin.editor.stage.approverPh")}
        options={withCurrent(p.options, g.groupId, t("process.admin.editor.gone"))}
        onChange={(v) => {
          const auto = g.label === "" || g.label === nameOf(g.groupId);
          const { groupKey: _drop, ...rest } = g;
          p.onChange({ ...rest, groupId: v, label: auto ? nameOf(v) : g.label });
        }}
      />
      <TextField
        id={`${p.uid}-pl${p.n}`}
        label={t(`${K}label`)}
        value={g.label}
        readOnly={p.readOnly}
        maxLength={PARALLEL_LABEL_MAX}
        onChange={(v) => p.onChange({ ...g, label: v })}
      />
      {p.canRemove && !p.readOnly ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="mt-6"
          aria-label={t(`${K}remove`, { n: p.n + 1 })}
          data-testid={`parallel-remove-${p.n}`}
          onClick={p.onRemove}
        >
          <X aria-hidden className="size-4" />
        </Button>
      ) : (
        <span />
      )}
      <Label className="col-span-3 flex items-center gap-2 font-normal">
        <Checkbox
          checked={g.headOnly === true}
          disabled={p.readOnly}
          data-testid={`parallel-head-${p.n}`}
          onCheckedChange={(v) => p.onChange({ ...g, headOnly: v === true })}
        />
        {t(`${K}headOnly`)}
      </Label>
    </li>
  );
}

function RulePicker(p: {
  uid: string;
  d: ParallelDraft;
  readOnly: boolean;
  error: string | undefined;
  onChange: (d: ParallelDraft) => void;
}) {
  const { t } = useTranslation();
  const { d } = p;
  return (
    <div className="grid grid-cols-2 items-start gap-3">
      <SelectField
        id={`${p.uid}-prule`}
        label={t(`${K}ruleLabel`)}
        value={d.rule}
        readOnly={p.readOnly}
        error={p.error ? t(p.error) : undefined}
        alert
        options={RULES.map((r) => ({ value: r, label: t(`${K}rule.${r}`, { n: 2 }) }))}
        onChange={(v) => p.onChange({ ...d, rule: v as ParallelRuleKind })}
      />
      {d.rule === "min" ? (
        <TextField
          id={`${p.uid}-pmin`}
          label={t(`${K}minLabel`, { max: d.groups.length })}
          type="number"
          min={1}
          max={Math.max(1, d.groups.length)}
          value={d.min}
          readOnly={p.readOnly}
          onChange={(v) => p.onChange({ ...d, min: v })}
        />
      ) : null}
    </div>
  );
}

export function StageApproveParallel(p: StageFormProps) {
  const { t } = useTranslation();
  const { stage, index, errors, readOnly, refs, onChange } = p;
  const options = refs.approverGroups ?? refs.groups;
  const d = stage.parallel;
  const nameOf = (id: string) => options.find((o) => o.value === id)?.label ?? "";
  const set = (next: ParallelDraft) => onChange({ parallel: next });
  const gErr = errors[`stages.${index}.after.parallel.groups`];
  const rErr =
    errors[`stages.${index}.after.parallel.rule`] ?? errors[`stages.${index}.after.parallel`];
  const toggle = (on: boolean) => {
    if (on)
      onChange({
        parallel: startParallel({ groupId: stage.groupId, label: nameOf(stage.groupId) }),
      });
    else {
      const first = d?.groups[0];
      onChange({ groupId: first?.groupId ?? stage.groupId, parallel: undefined });
    }
  };
  return (
    <div className="space-y-3" data-testid="stage-approve-parallel">
      <Label className="flex items-center gap-2 font-normal">
        <Checkbox
          checked={!!d}
          disabled={readOnly}
          data-testid="parallel-toggle"
          onCheckedChange={(v) => toggle(v === true)}
        />
        {t(`${K}toggle`)}
      </Label>
      {d ? (
        <>
          <p className="m-0 text-caption text-muted-foreground">{t(`${K}hint`)}</p>
          <ul className="m-0 list-none space-y-2 p-0" data-testid="parallel-groups">
            {d.groups.map((g, i) => (
              <GroupRow
                // biome-ignore lint/suspicious/noArrayIndexKey: hàng không có định danh riêng; thêm/bớt giữ thứ tự
                key={i}
                uid={stage.uid}
                n={i}
                g={g}
                options={options}
                readOnly={readOnly}
                canRemove={d.groups.length > PARALLEL_GROUPS.min}
                onChange={(ng) => set({ ...d, groups: d.groups.map((x, j) => (j === i ? ng : x)) })}
                onRemove={() => set({ ...d, groups: d.groups.filter((_, j) => j !== i) })}
              />
            ))}
          </ul>
          {gErr ? (
            <p
              role="alert"
              className="m-0 text-caption text-destructive"
              data-testid="parallel-groups-error"
            >
              {t(gErr)}
            </p>
          ) : null}
          {d.groups.length < PARALLEL_GROUPS.max && !readOnly ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="parallel-add"
              onClick={() => set({ ...d, groups: [...d.groups, emptyParallelGroup()] })}
            >
              <Plus aria-hidden className="size-4" />
              {t(`${K}add`)}
            </Button>
          ) : null}
          <RulePicker uid={stage.uid} d={d} readOnly={readOnly} error={rErr} onChange={set} />
        </>
      ) : null}
    </div>
  );
}
