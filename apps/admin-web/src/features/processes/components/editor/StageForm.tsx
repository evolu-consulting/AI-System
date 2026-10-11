// ADM-FR-66 · CR-056 · P-a F5: một giai đoạn trong accordion — `region "Giai đoạn n: <tên>"` (plan-frontend-admin §1, e2e §2).
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { EditorRefs } from "../../hooks/use-editor-refs";
import { withCurrent } from "../../hooks/use-editor-refs";
import { canRealAction, type DraftErrors, type StageDraft } from "../../lib/def-form";
import { SelectField, TextField } from "./Fields";
import { StageMustKnow } from "./StageMustKnow";
import { StageOutput } from "./StageOutput";
import { StageSourcesField } from "./StageSourcesField";

export type StageFormProps = {
  stage: StageDraft;
  index: number;
  all: StageDraft[];
  /** Nguồn khai báo ở quy trình (P-b). */
  defSources: readonly string[];
  errors: DraftErrors;
  readOnly: boolean;
  refs: EditorRefs;
  onChange: (patch: Partial<StageDraft>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
};

function AnswererFields({ stage, index, errors, readOnly, refs, onChange }: StageFormProps) {
  const { t } = useTranslation();
  const gone = t("process.admin.editor.gone");
  const err = errors[`stages.${index}.answerer`];
  const kinds = (["starter", "group", "user"] as const).map((k) => ({
    value: k,
    label: t(`process.admin.editor.stage.${k === "starter" ? "starter" : k}`),
  }));
  const list = stage.answerer === "group" ? refs.groups : refs.users;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <SelectField
        id={`${stage.uid}-answerer`}
        label={t("process.admin.editor.stage.answerer")}
        value={stage.answerer}
        readOnly={readOnly}
        options={kinds}
        onChange={(v) => onChange({ answerer: v as StageDraft["answerer"], answererId: "" })}
      />
      {stage.answerer === "starter" ? null : (
        <SelectField
          id={`${stage.uid}-answerer-id`}
          label={t(`process.admin.editor.stage.${stage.answerer}`)}
          value={stage.answererId}
          readOnly={readOnly}
          error={err ? t(err) : undefined}
          options={withCurrent(list, stage.answererId, gone)}
          onChange={(v) => onChange({ answererId: v })}
        />
      )}
    </div>
  );
}

function AfterFields(p: StageFormProps) {
  const { t } = useTranslation();
  const { stage, index, errors, readOnly, refs, onChange } = p;
  const gErr = errors[`stages.${index}.after.group_id`];
  const rErr = errors[`stages.${index}.real_action`];
  const locked = !canRealAction(p.all, index);
  const realId = `${stage.uid}-real`;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <SelectField
        id={`${stage.uid}-after`}
        label={t("process.admin.editor.stage.after")}
        value={stage.after}
        readOnly={readOnly}
        options={[
          { value: "review", label: t("process.admin.editor.stage.review") },
          { value: "auto", label: t("process.admin.editor.stage.auto") },
        ]}
        onChange={(v) => onChange({ after: v as StageDraft["after"] })}
      />
      {stage.after === "review" ? (
        <SelectField
          id={`${stage.uid}-group`}
          label={t("process.admin.editor.stage.reviewGroup")}
          value={stage.groupId}
          readOnly={readOnly}
          error={gErr ? t(gErr) : undefined}
          options={withCurrent(refs.groups, stage.groupId, t("process.admin.editor.gone"))}
          onChange={(v) => onChange({ groupId: v })}
        />
      ) : null}
      <div className="space-y-1">
        <div
          className="flex items-center gap-2"
          title={locked ? t("process.admin.editor.stage.realLocked") : undefined}
        >
          <Switch
            id={realId}
            checked={stage.real}
            disabled={readOnly || locked}
            aria-describedby={locked ? `${realId}-hint` : undefined}
            onCheckedChange={(v) => onChange({ real: v })}
          />
          <Label htmlFor={realId}>{t("process.admin.editor.stage.real")}</Label>
        </div>
        {locked ? (
          <p id={`${realId}-hint`} className="text-caption text-muted-foreground">
            {t("process.admin.editor.stage.realLocked")}
          </p>
        ) : null}
        {rErr ? <p className="text-caption text-destructive">{t(rErr)}</p> : null}
      </div>
    </div>
  );
}

export function StageForm(p: StageFormProps) {
  const { t } = useTranslation();
  const { stage, index, errors, readOnly, refs, onChange } = p;
  const e = (f: string): string | undefined => {
    const k = errors[`stages.${index}.${f}`];
    return k ? t(k) : undefined;
  };
  const executors = withCurrent(
    [...refs.agents, ...refs.teams],
    stage.executor,
    t("process.admin.editor.gone"),
  );
  return (
    <section
      aria-label={t("process.admin.editor.stage.aria", { n: index + 1, name: stage.name })}
      className="space-y-4 px-1"
    >
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
        error={e("executor")}
        options={executors}
        onChange={(v) => onChange({ executor: v })}
      />
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
      <StageOutput
        stage={stage}
        index={index}
        errors={errors}
        readOnly={readOnly}
        onChange={onChange}
      />
      <StageSourcesField {...p} stage={stage} />
      <AfterFields {...p} />
      <AnswererFields {...p} />
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
        <TextField
          id={`${stage.uid}-budget`}
          label={t("process.admin.editor.stage.budget")}
          type="number"
          value={stage.budget}
          error={e("token_budget")}
          readOnly={readOnly}
          onChange={(v) => onChange({ budget: v })}
        />
      </div>
      <StageMustKnow {...p} />
      {readOnly ? null : (
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={index === 0}
            onClick={() => p.onMove(-1)}
          >
            <ArrowUp aria-hidden className="size-4" />
            {t("process.admin.editor.up")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={index === p.all.length - 1}
            onClick={() => p.onMove(1)}
          >
            <ArrowDown aria-hidden className="size-4" />
            {t("process.admin.editor.down")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={p.all.length <= 1}
            onClick={p.onRemove}
          >
            <Trash2 aria-hidden className="size-4" />
            {t("process.admin.editor.remove")}
          </Button>
        </div>
      )}
    </section>
  );
}
