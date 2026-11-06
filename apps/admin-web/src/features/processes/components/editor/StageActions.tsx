// ADM-FR-66 · ADM-FR-71 · P-b2: nút thao tác giai đoạn — Lên/Xuống (trong bước), đổi bước, tách bước, xoá.
// Đây cũng là đường bàn phím/đọc màn hình thay cho kéo thả (plan-frontend FB8).
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  MoreHorizontal,
  Split,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { columnNeighbor } from "../../lib/step-ops";
import { useFlowCtx } from "../flow/flow-ctx";
import type { StageFormProps } from "./stage-form-props";

export function StageActions(p: StageFormProps) {
  const { t } = useTranslation();
  const { stage, index, all } = p;
  const flow = useFlowCtx();
  if (p.readOnly) return null;
  const alone = all.filter((s) => s.step === stage.step).length <= 1;
  const btn = (label: string, icon: React.ReactNode, onClick: () => void, disabled = false) => (
    <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onClick}>
      {icon}
      {label}
    </Button>
  );
  const ic = "size-4";
  // CR-122 · U2d · flow: kéo thả trên canvas thay cho Lên/Xuống/đổi bước; thao tác bàn phím gom vào menu "⋯", chỉ còn Xoá ngoài menu.
  if (flow) return <FlowActions {...p} alone={alone} />;
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

function FlowActions(p: StageFormProps & { alone: boolean }) {
  const { t } = useTranslation();
  const { stage, index, all } = p;
  const item = (label: string, icon: React.ReactNode, onClick: () => void, disabled = false) => (
    <DropdownMenuItem disabled={disabled} onSelect={onClick}>
      {icon}
      {label}
    </DropdownMenuItem>
  );
  return (
    <div className="flex items-center gap-2 border-t border-border pt-3">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={all.length <= 1}
        onClick={p.onRemove}
      >
        <Trash2 aria-hidden className="size-4" />
        {t("process.admin.editor.remove")}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("process.admin.flow.moreActions")}
            title={t("process.admin.flow.moreActions")}
          >
            <MoreHorizontal aria-hidden className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {item(
            t("process.admin.editor.up"),
            <ArrowUp aria-hidden className="size-4" />,
            () => p.onMove(-1),
            columnNeighbor(all, index, -1) < 0,
          )}
          {item(
            t("process.admin.editor.down"),
            <ArrowDown aria-hidden className="size-4" />,
            () => p.onMove(1),
            columnNeighbor(all, index, 1) < 0,
          )}
          {item(
            t("process.admin.editor.stage.prevStep"),
            <ArrowLeft aria-hidden className="size-4" />,
            () => p.onStep(stage.step - 1),
            stage.step === 0,
          )}
          {item(
            t("process.admin.editor.stage.nextStep"),
            <ArrowRight aria-hidden className="size-4" />,
            () => p.onStep(stage.step + 1),
          )}
          {item(
            t("process.admin.editor.stage.splitStep"),
            <Split aria-hidden className="size-4" />,
            p.onSplit,
            p.alone,
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
