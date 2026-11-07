// ADM-FR-71 · P-b2 (plan-frontend §1): thanh công cụ thẻ Giai đoạn — "Thêm giai đoạn" (bước mới cuối) và "Thêm bước"
// (chèn bước mới sau bước của giai đoạn đang chọn); tắt khi đủ 10 giai đoạn.
import { LayoutTemplate, ListPlus, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useStagesMax } from "../../hooks/use-stages-max";

type Props = {
  count: number;
  onAddStage: () => void;
  onAddStep: () => void;
  /** fnr-canvas · "Sắp xếp": bỏ vị trí đã lưu, bố cục chuẩn theo làn nhánh If. */
  onArrange: () => void;
  /** Chỗ cho tablist Canvas/Danh sách (FB-4). */
  children?: ReactNode;
};

export function CanvasToolbar({ count, onAddStage, onAddStep, onArrange, children }: Props) {
  const { t } = useTranslation();
  const max = useStagesMax();
  const full = count >= max;
  const tip = full ? t("process.admin.canvas.err.stagesMax", { max }) : undefined;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={full}
        title={tip}
        onClick={onAddStage}
      >
        <Plus aria-hidden className="size-4" />
        {t("process.admin.canvas.toolbar.addStage")}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={full}
        title={tip}
        onClick={onAddStep}
      >
        <ListPlus aria-hidden className="size-4" />
        {t("process.admin.canvas.toolbar.addStep")}
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={onArrange}>
        <LayoutTemplate aria-hidden className="size-4" />
        {t("process.admin.canvas.toolbar.arrange")}
      </Button>
      {full ? <span className="text-caption text-muted-foreground">{tip}</span> : null}
      <div className="ml-auto">{children}</div>
    </div>
  );
}
