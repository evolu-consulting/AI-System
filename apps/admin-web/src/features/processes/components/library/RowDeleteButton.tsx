// CR-105 · nút Xoá của dòng quy trình: bị khoá khi là mặc định của khe hoặc đang có tenant gán — kèm tooltip nêu lý do
// ("Đang được N tenant dùng — bỏ gán trước khi xoá"). Nút khoá không nhận chuột nên tooltip gắn lên <span> bọc ngoài.
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { deleteLock } from "../../lib/library-view";
import type { LibraryListItem } from "../../library-api";

export function RowDeleteButton(p: {
  row: Pick<LibraryListItem, "slot" | "is_default" | "tenant_count" | "enabled">;
  label: string;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const lock = deleteLock(p.row);
  if (!lock)
    return (
      <Button size="sm" variant="ghost" onClick={p.onDelete}>
        {p.label}
      </Button>
    );
  const why =
    lock.reason === "assigned"
      ? t("process.admin.library.inUse.assignedN", { n: lock.n })
      : t("process.admin.library.inUse.default");
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex" data-testid="delete-locked">
            <Button size="sm" variant="ghost" disabled>
              {p.label}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{why}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
