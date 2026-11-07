// ADM-FR-71 · P-b2 (plan-frontend §1) · CR-123 Luật GỐC 2: MỘT nút "Thêm bước" (chèn bước mới sau bước đang chọn; chưa chọn ⇒ cuối); tắt khi đủ số bước.
import { LayoutTemplate, ListPlus } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useStagesMax } from "../../hooks/use-stages-max";

type Props = {
  count: number;
  onAddStep: () => void;
  /** fnr-canvas · "Sắp xếp": bỏ vị trí đã lưu, bố cục chuẩn theo làn nhánh If. */
  onArrange: () => void;
  /** Chỗ cho tablist Canvas/Danh sách (FB-4). */
  children?: ReactNode;
};

export function CanvasToolbar({ count, onAddStep, onArrange, children }: Props) {
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
