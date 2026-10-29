// ADM-FR-66 · P-a F5: phần chung của giai đoạn — tên, mã, người làm, hướng dẫn; và hạn/ngân sách token.
import type { ExecutorKind } from "@ai/contracts/hub-admin";
import { useTranslation } from "react-i18next";
import { withCurrent } from "../../hooks/use-editor-refs";
import { applyKeyOnly, isApply } from "../../lib/apply-form";
import { swapCheck } from "../../lib/swap-guard";
import { isTool } from "../../lib/tool-form";
import { isWait } from "../../lib/wait-form";
import { draftKindOf, FE_NODES, feNodeOf } from "../../nodes/registry";
import { type Option, SelectField, TextField } from "./Fields";
import type { StageFormProps } from "./stage-form-props";

/** CR-103 · R3: đổi loại node — giữ name/key/step/after/answerer/output, chỉ đặt lại cấu hình executor theo `defaults()` của registry. */
function swapPatch(v: string) {
  const kind = draftKindOf(v);
  return kind !== null && feNodeOf(kind).draftValue !== null
    ? { ...feNodeOf(kind).defaults(), executor: v }
    : { executor: v };
}
/** Lỗi `executor` đã hiện ở khối riêng (Áp bản sửa / Gọi tool) ⇒ không in lại dưới ô "Người thực hiện". */
const ownedElsewhere = (k: string | undefined): boolean =>
  applyKeyOnly(k) || k?.startsWith("process.admin.editor.stage.tool.err.") === true;

function useStageError(p: StageFormProps) {
  const { t } = useTranslation();
  return (f: string): string | undefined => {
    const k = p.errors[`stages.${p.index}.${f}`];
    return k ? t(k) : undefined;
  };
}

export function StageGeneral(p: StageFormProps) {
  const { t } = useTranslation();
  const { stage, readOnly, refs, onChange } = p;
  const e = useStageError(p);
  // CR-103 · R3: loại node lấy từ registry FE (loại đăng ký sau tự hiện); khác họ / mất field bước sau dùng ⇒ vô hiệu + lý do.
  const guard = (kind: ExecutorKind, o: Option): Option => {
    const r = swapCheck(p.all, p.index, kind);
    if (r.ok) return o;
    const m = /^([^.]+)\.[^:]+:(.*)$/.exec(r.detail);
    return {
      ...o,
      disabled: true,
      title: t(`process.admin.editor.stage.swap.${r.reason}`, { by: m?.[1], field: m?.[2] }),
    };
  };
  const fixed = Object.values(FE_NODES).filter((n) => n.draftValue !== null && n.labelKey !== null);
  const executors = withCurrent(
    [
      ...refs.agents.map((o) => guard("agent", o)),
      ...refs.teams.map((o) => guard("team", o)),
      ...fixed.map((n) => guard(n.kind, { value: n.draftValue ?? "", label: t(n.labelKey ?? "") })),
    ],
    stage.executor,
    t("process.admin.editor.gone"),
  );
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          id={`${stage.uid}-name`}
          label={t("process.admin.editor.stage.name")}
          value={stage.name}
          error={e("name")}
          readOnly={readOnly}
          onChange={(v) => onChange({ name: v })}
        />
        <TextField
          id={`${stage.uid}-key`}
          label={t("process.admin.editor.stage.key")}
          value={stage.key}
          error={e("key")}
          readOnly={readOnly}
          mono
          onChange={(v) => onChange({ key: v, keyAuto: false })}
        />
      </div>
      <SelectField
        id={`${stage.uid}-exec`}
        label={t("process.admin.editor.stage.executor")}
        value={stage.executor}
        readOnly={readOnly}
        error={ownedElsewhere(p.errors[`stages.${p.index}.executor`]) ? undefined : e("executor")}
        options={executors}
        onChange={(v) => onChange(swapPatch(v))}
      />
      {isApply(stage) || isWait(stage) || isTool(stage) ? null : (
        <TextField
          id={`${stage.uid}-instr`}
          label={t("process.admin.editor.stage.instruction")}
          value={stage.instruction}
          error={e("instruction")}
          readOnly={readOnly}
          multiline
          rows={4}
          onChange={(v) => onChange({ instruction: v })}
        />
      )}
    </>
  );
}

export function StageLimits(p: StageFormProps) {
  const { t } = useTranslation();
  const { stage, readOnly, onChange } = p;
  const e = useStageError(p);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <TextField
        id={`${stage.uid}-timeout`}
        label={t("process.admin.editor.stage.timeout")}
        type="number"
        value={stage.timeout}
        error={e("timeout_s")}
        readOnly={readOnly}
        onChange={(v) => onChange({ timeout: v })}
      />
      {isApply(stage) || isTool(stage) ? null : (
        <TextField
          id={`${stage.uid}-budget`}
          label={t("process.admin.editor.stage.budget")}
          type="number"
          value={stage.budget}
          error={e("token_budget")}
          readOnly={readOnly}
          onChange={(v) => onChange({ budget: v })}
        />
      )}
    </div>
  );
}
