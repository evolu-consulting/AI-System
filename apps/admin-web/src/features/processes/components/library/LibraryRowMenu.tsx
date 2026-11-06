// CR-121 f9 (UAT L2) · hành động của một dòng Thư viện gom vào menu "⋯" (như các bảng khác của admin) — bảng không tràn ở 1440px.
// Sửa (mở trình sửa) · Nhân bản · Xoá (khoá + lý do khi là mặc định của khe / đang có công ty dùng).
import { Link } from "@tanstack/react-router";
import { MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deleteLock } from "../../lib/library-view";
import type { LibraryListItem } from "../../library-api";

type Props = { row: LibraryListItem; onClone: () => void; onDelete: () => void };

export function LibraryRowMenu({ row, onClone, onDelete }: Props) {
  const { t } = useTranslation();
  const lock = deleteLock(row);
  const why = !lock
    ? undefined
    : lock.reason === "assigned"
      ? t("process.admin.library.inUse.assignedN", { n: lock.n })
      : t("process.admin.library.inUse.default");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("common.moreActions")}
          data-testid="library-row-menu"
        >
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      {/* menu nằm trong portal nhưng sự kiện vẫn nổi lên hàng ⇒ chặn để bấm menu không mở trình sửa */}
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem asChild>
          <Link to="/processes/$processId" params={{ processId: row.id }}>
            {t("process.admin.list.edit")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onClone}>
          {t("process.admin.library.clone.button")}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!!lock}
          title={why}
          data-testid={lock ? "delete-locked" : "delete-row"}
          onSelect={onDelete}
        >
          {t("process.admin.list.deleteButton")}
        </DropdownMenuItem>
        {why ? <p className="px-2 pb-1 text-caption text-muted-foreground">{why}</p> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
