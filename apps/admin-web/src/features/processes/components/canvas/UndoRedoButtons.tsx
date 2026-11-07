// CR-123 · p25 · FLOW3-FR-06: nút Hoàn tác / Làm lại của trình sửa (cùng việc với Ctrl+Z / Ctrl+Y khi canvas đang giữ focus).
import { Redo2, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { DraftState } from "../../hooks/use-draft";
import type { StageOps } from "../../hooks/use-stage-ops";

export function UndoRedoButtons({ d, ops }: { d: DraftState; ops: StageOps }) {
  const { t } = useTranslation();
  const undo = t("process.admin.canvas.edit.undo");
  const redo = t("process.admin.canvas.edit.redo");
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={undo}
        title={undo}
        disabled={!d.canUndo}
        data-testid="canvas-undo"
        onClick={ops.undo}
      >
        <Undo2 aria-hidden className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={redo}
        title={redo}
        disabled={!d.canRedo}
        data-testid="canvas-redo"
        onClick={ops.redo}
      >
        <Redo2 aria-hidden className="size-4" />
      </Button>
    </>
  );
}
