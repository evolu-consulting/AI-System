// HUB-FR-129 · PC2-R01 · P-c2 F2 (plan-frontend FC9/FC10; mockup Pc2-Editor): khối stage "Áp bản sửa" — mô tả, "Hành động thật" bật
// cứng, "Sau stage" = chạy tiếp cứng, huy hiệu "Hợp lệ", ghi chú nhánh và vùng lỗi `APPLY_*` (live, cùng luật server).
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { applyBlockErrors, applyIssueList, firstApplyName } from "../../lib/apply-form";
import { SelectField } from "./Fields";
import type { StageFormProps } from "./stage-form-props";

const K = "process.admin.apply.";

export function StageApply(p: StageFormProps) {
  const { t } = useTranslation();
  const { stage, index, all, errors } = p;
  const keys = applyBlockErrors(applyIssueList(all), errors, index);
  const realId = `${stage.uid}-real`;
  const stepErr = errors[`stages.${index}.real_action`];
  return (
    <fieldset className="space-y-3" data-testid="stage-apply">
      <div className="flex items-center justify-between gap-2">
        <strong className="text-label font-medium">{t(`${K}title`)}</strong>
        {keys.length === 0 ? <Badge variant="ok">{t(`${K}valid`)}</Badge> : null}
      </div>
      <p className="text-caption text-muted-foreground">{t(`${K}hint`)}</p>
      {keys.map((k) => (
        <Alert key={k} variant="destructive" role="alert" className="bg-danger-bg">
          <AlertDescription>{t(k, { stage: firstApplyName(all) })}</AlertDescription>
        </Alert>
      ))}
      <div className="space-y-1">
        <Label htmlFor={realId}>{t(`${K}realAction`)}</Label>
        <div className="flex items-center gap-2">
          <Switch id={realId} checked disabled />
          <span className="text-caption text-muted-foreground">{t(`${K}fixed`)}</span>
        </div>
        {stepErr && !stepErr.startsWith(K) ? (
          <p className="text-caption text-destructive">{t(stepErr)}</p>
        ) : null}
      </div>
      <SelectField
        id={`${stage.uid}-after`}
        label={t("process.admin.editor.stage.after")}
        value="auto"
        disabled
        readOnly={p.readOnly}
        options={[{ value: "auto", label: t(`${K}after.fixed`) }]}
        onChange={() => undefined}
      />
      <Alert role="status">
        <AlertDescription>{t(`${K}note`)}</AlertDescription>
      </Alert>
    </fieldset>
  );
}
