// ADM-FR-66 · ADM-FR-71 · P-b2: nút thao tác giai đoạn — Lên/Xuống (trong bước), đổi bước, tách bước, xoá.
// Đây cũng là đường bàn phím/đọc màn hình thay cho kéo thả (plan-frontend FB8).
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Split, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { columnNeighbor } from "../../lib/step-ops";
import type { StageFormProps } from "./stage-form-props";

export function StageActions(p: StageFormProps) {
  const { t } = useTranslation();
  const { stage, index, all } = p;
  if (p.readOnly) return null;
  const alone = all.filter((s) => s.step === stage.step).length <= 1;
  const btn = (label: string, icon: React.ReactNode, onClick: () => void, disabled = false) => (
    <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onClick}>
      {icon}
      {label}
    </Button>
  );
  const ic = "size-4";
  return (
    <div className="flex flex-wrap gap-2 border-t border-border pt-3">
      {btn(
        t("process.admin.editor.up"),
        <ArrowUp aria-hidden className={ic} />,
        () => p.onMove(-1),
        columnNeighbor(all, index, -1) < 0,
      )}
      {btn(
        t("process.admin.editor.down"),
        <ArrowDown aria-hidden className={ic} />,
        () => p.onMove(1),
        columnNeighbor(all, index, 1) < 0,
      )}
      {btn(
        t("process.admin.editor.stage.prevStep"),
        <ArrowLeft aria-hidden className={ic} />,
        () => p.onStep(stage.step - 1),
        stage.step === 0,
      )}
      {btn(
        t("process.admin.editor.stage.nextStep"),
        <ArrowRight aria-hidden className={ic} />,
        () => p.onStep(stage.step + 1),
      )}
      {btn(
        t("process.admin.editor.stage.splitStep"),
        <Split aria-hidden className={ic} />,
        p.onSplit,
        alone,
      )}
      {btn(
        t("process.admin.editor.remove"),
        <Trash2 aria-hidden className={ic} />,
        p.onRemove,
        all.length <= 1,
      )}
    </div>
  );
}
