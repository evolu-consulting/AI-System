// ADM-FR-62 · menu `⋯` của hàng Group: Sửa · Xoá (beta-testers: "Xoá" khoá kèm tooltip, M3-R02).
import type { GroupListItem } from "@ai/contracts";
import { MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Props = {
  group: GroupListItem;
  onEdit: (g: GroupListItem) => void;
  onDelete: (g: GroupListItem) => void;
};

export function GroupRowMenu({ group, onEdit, onDelete }: Props) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("common.moreActions")}>
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onEdit(group)}>{t("groups.menu.edit")}</DropdownMenuItem>
        <DropdownMenuItem
          disabled={group.is_beta}
          title={group.is_beta ? t("groups.protected.tip") : undefined}
          onSelect={() => onDelete(group)}
        >
          {t("groups.menu.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
