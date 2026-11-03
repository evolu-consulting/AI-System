// CR-105 UX · thanh công cụ Canvas của quy trình khe + "Sắp xếp". dlc-engine: nút thêm là nút TÁCH — bấm phần chính = "Thêm bước
// duyệt" (mặc định, như cũ), mũi tên mở menu "Thêm bước duyệt" / "Thêm bước DLC". Hai loại bước không nối với nhau trong một
// sơ đồ (trộn ⇒ lỗi KIND_MIX, không lưu được).
import { PROCESS_STAGES_MAX } from "@ai/contracts/hub-admin";
import { ChevronDown, LayoutTemplate, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Props = { count: number; onAdd: () => void; onAddDlc: () => void; onArrange: () => void };

export function SlotCanvasToolbar({ count, onAdd, onAddDlc, onArrange }: Props) {
  const { t } = useTranslation();
  const full = count >= PROCESS_STAGES_MAX;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-r-none"
          disabled={full}
          onClick={onAdd}
        >
          <Plus aria-hidden className="size-4" />
          {t("process.admin.library.canvas.addStep")}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="-ml-px rounded-l-none px-2"
              disabled={full}
              aria-label={t("process.admin.library.canvas.addMenu")}
            >
              <ChevronDown aria-hidden className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={onAdd}>
              {t("process.admin.library.canvas.addStep")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onAddDlc}>
              {t("process.admin.library.canvas.addDlcStep")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onArrange}>
        <LayoutTemplate aria-hidden className="size-4" />
        {t("process.admin.canvas.toolbar.arrange")}
      </Button>
    </div>
  );
}
