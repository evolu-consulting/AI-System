// ADM-FR-71 · P-b2 (plan-frontend §2 "Lối tắt"): nút "?" hiện danh sách phím tắt của canvas (không phím toàn cục).
import { CircleHelp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function ShortcutsHint() {
  const { t } = useTranslation();
  const title = t("process.admin.canvas.shortcuts.title");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={title} title={title}>
          <CircleHelp aria-hidden className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="space-y-1 text-caption">
        <p className="font-medium">{title}</p>
        <p>{t("process.admin.canvas.shortcuts.move")}</p>
        <p>{t("process.admin.canvas.shortcuts.open")}</p>
      </PopoverContent>
    </Popover>
  );
}
