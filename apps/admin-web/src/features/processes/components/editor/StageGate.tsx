// ADM-FR-66 · P-a F5 · P-b2: "Sau giai đoạn" (duyệt/tự chạy), nhóm kiểm và "Hành động thật" (khoá theo bước liền trước).
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { withCurrent } from "../../hooks/use-editor-refs";
import { canRealAction, type StageDraft } from "../../lib/def-form";
import { SelectField } from "./Fields";
import type { StageFormProps } from "./stage-form-props";

export function StageGate(p: StageFormProps) {
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
