// CR-105 UX · thanh công cụ Canvas của quy trình khe: MỘT nút "Thêm bước duyệt" (bỏ "Thêm giai đoạn"/"Thêm bước") + "Sắp xếp".
import { PROCESS_STAGES_MAX } from "@ai/contracts/hub-admin";
import { LayoutTemplate, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

type Props = { count: number; onAdd: () => void; onArrange: () => void };

export function SlotCanvasToolbar({ count, onAdd, onArrange }: Props) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={count >= PROCESS_STAGES_MAX}
        onClick={onAdd}
      >
        <Plus aria-hidden className="size-4" />
        {t("process.admin.library.canvas.addStep")}
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={onArrange}>
        <LayoutTemplate aria-hidden className="size-4" />
        {t("process.admin.canvas.toolbar.arrange")}
      </Button>
    </div>
  );
}
