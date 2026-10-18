// ADM-FR-71 · HUB-FR-147 · AC-H45 · P-d2 (plan-frontend-d2 §10; mockup 04 E3): khối "Rẽ nhánh" dưới "Sau giai đoạn" — luật đầu tiên khớp
// được dùng; khoá khi giai đoạn không đứng một mình trong bước hoặc chưa có trường cấu trúc. Lỗi: live (contract) + server theo path.
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { BRANCH_RULES_MAX, gotoSteps, isStandalone } from "../../domain/branch-rules";
import { emptyBranch } from "../../lib/branch-form";
import { branchOff } from "../../lib/d2-validate";
import { BranchRuleRow, type CellErrors } from "./BranchRuleRow";
import type { StageFormProps } from "./stage-form-props";

const K = "process.admin.editor.stage.branch.";
const CELLS = ["field", "op", "value", "goto_step"] as const;

export function StageBranch(p: StageFormProps) {
  const { t } = useTranslation();
  const { stage, index, all, errors, readOnly, onChange } = p;
  if (branchOff(stage)) return null;
  const alone = isStandalone(all, index);
  const noFields = stage.fields.length === 0;
  const steps = gotoSteps(all, stage.step).map((s) => s + 1);
  const rules = stage.branch;
  const set = (j: number, patch: Partial<(typeof rules)[number]>) =>
    onChange({ branch: rules.map((r, k) => (k === j ? { ...r, ...patch } : r)) });
  const cells = (j: number): CellErrors =>
    Object.fromEntries(
      CELLS.flatMap((c) => {
        const k = errors[`stages.${index}.after.branch.${j}.${c}`];
        return k ? [[c, k]] : [];
      }),
    );
  const groupErr = errors[`stages.${index}.after.branch`];
  const full = rules.length >= BRANCH_RULES_MAX;
  return (
    <fieldset
      aria-label={t(`${K}title`)}
      disabled={!alone || readOnly}
      className="space-y-3"
      data-testid="stage-branch"
    >
      <strong className="text-label font-medium">{t(`${K}title`)}</strong>
      <p className="text-caption text-muted-foreground">{t(`${K}hint`)}</p>
      {alone ? null : (
        <Alert role="status" className="bg-warning-bg">
          <AlertDescription>{t(`${K}locked`)}</AlertDescription>
        </Alert>
      )}
      {alone && noFields && rules.length === 0 ? (
        <p className="text-caption text-muted-foreground">{t(`${K}noFields`)}</p>
      ) : null}
      {rules.map((r, j) => (
        <BranchRuleRow
          // biome-ignore lint/suspicious/noArrayIndexKey: luật không có danh tính ổn định
          key={j}
          id={`${stage.uid}-br${j}`}
          n={j + 1}
          rule={r}
          fields={stage.fields}
          steps={steps}
          readOnly={readOnly || !alone}
          errors={cells(j)}
          onChange={(patch) => set(j, patch)}
          onRemove={() => onChange({ branch: rules.filter((_, k) => k !== j) })}
        />
      ))}
      {groupErr ? (
        <Alert role="alert" variant="destructive">
          <AlertDescription>{t(groupErr)}</AlertDescription>
        </Alert>
      ) : null}
      {readOnly ? null : full ? (
        <p className="text-caption text-muted-foreground">{t(`${K}max`)}</p>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!alone || noFields}
          onClick={() => onChange({ branch: [...rules, emptyBranch()] })}
        >
          <Plus aria-hidden className="size-4" />
          {t(`${K}add`)}
        </Button>
      )}
    </fieldset>
  );
}
