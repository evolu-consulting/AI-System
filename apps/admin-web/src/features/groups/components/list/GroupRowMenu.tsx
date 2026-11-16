// ADM-FR-62 · menu `⋯` của hàng Group: Sửa · Xoá (beta-testers: "Xoá" khoá kèm tooltip, M3-R02).
import type { GroupListItem } from "@ai/contracts/groups";
import { Button } from "@ai/web-kit/ui/kit/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ai/web-kit/ui/kit/dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";

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
        <Button variant="quiet" size="icon" aria-label={t("common.moreActions")}>
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
