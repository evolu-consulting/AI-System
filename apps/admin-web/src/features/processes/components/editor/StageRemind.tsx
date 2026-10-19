// ADM-FR-71 · HUB-FR-144 · P-d1 T11b (plan-frontend §2 "Duyệt"; mockup A3): "Nhắc mỗi (giờ)" + "Chuyển cấp nếu chưa ai kiểm"
// (sau N giờ, tới nhóm khác nhóm kiểm). Chỉ hiện khi "Sau giai đoạn" = Duyệt; tự chạy tiếp ⇒ gửi null (xử lý ở def-form).
import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { escalateIssueKey, remindIssueKey } from "../../domain/error-keys";
import { escalateIssues, remindIssue } from "../../domain/remind-rules";
import { withCurrent } from "../../hooks/use-editor-refs";
import { SelectField, TextField } from "./Fields";
import type { StageFormProps } from "./stage-form-props";

const K = "process.admin.editor.stage.";

export function StageRemind(p: StageFormProps) {
  const { t } = useTranslation();
  const { stage, index, errors, readOnly, refs, onChange } = p;
  if (stage.after !== "review") return null;
  const at = (f: string) => errors[`stages.${index}.after.${f}`];
  const key = (k: string | undefined) => (k ? t(k) : undefined);
  const esc = stage.escalate;
  const setEsc = (patch: Partial<typeof esc>) => onChange({ escalate: { ...esc, ...patch } });
  const live = escalateIssues(esc, stage.groupId);
  const remindErr = remindIssue(stage.remind) ? remindIssueKey() : at("remind_every_h");
  const afterErr = esc.on && live.afterH ? escalateIssueKey("afterH") : at("escalate.after_h");
  const groupErr = live.groupId === "same" ? escalateIssueKey("groupId") : at("escalate.group_id");
  const groups = withCurrent(
    refs.groups.filter((g) => g.value !== stage.groupId),
    esc.groupId,
    t("process.admin.editor.gone"),
  );
  const cbId = `${stage.uid}-escalate`;
  const exId = `${stage.uid}-exclude-starter`;
  return (
    <div className="space-y-3">
      {/* N2-FR-05 · người bắt đầu lượt chạy không được duyệt bước này (vd duyệt cấp 2). */}
      <div className="flex items-center gap-2">
        <Checkbox
          id={exId}
          checked={stage.excludeStarter === true}
          disabled={readOnly}
          onCheckedChange={(v) => onChange({ excludeStarter: v === true })}
        />
        <Label htmlFor={exId}>{t(`${K}excludeStarter`)}</Label>
      </div>
      <TextField
        id={`${stage.uid}-remind`}
        label={t(`${K}remindEvery`)}
        type="number"
        min={4}
        max={168}
        value={stage.remind}
        readOnly={readOnly}
        description={t(`${K}remindHint`)}
        alert
        error={key(remindErr)}
        onChange={(v) => onChange({ remind: v })}
      />
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Checkbox
            id={cbId}
            checked={esc.on}
            disabled={readOnly}
            onCheckedChange={(v) => setEsc({ on: v === true })}
          />
          <Label htmlFor={cbId}>{t(`${K}escalate`)}</Label>
        </div>
        {esc.on ? (
          <div className="ml-6 space-y-2">
            <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
              <TextField
                id={`${stage.uid}-escalate-after`}
                label={t(`${K}escalateAfter`)}
                type="number"
                min={4}
                max={2160}
                value={esc.afterH}
                readOnly={readOnly}
                alert
                error={key(afterErr)}
                onChange={(v) => setEsc({ afterH: v })}
              />
              <SelectField
                id={`${stage.uid}-escalate-group`}
                label={t(`${K}escalateGroup`)}
                value={esc.groupId}
                readOnly={readOnly}
                alert
                error={key(groupErr)}
                options={groups}
                onChange={(v) => setEsc({ groupId: v })}
              />
            </div>
            <p className="text-caption text-muted-foreground">{t(`${K}escalateHint`)}</p>
            {at("escalate") ? (
              <p role="alert" className="text-caption text-destructive">
                {t(at("escalate") as string)}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
