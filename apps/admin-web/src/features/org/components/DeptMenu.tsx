// CR-189 · «⋯» trên thẻ phòng (chế độ sửa): Đổi trưởng phòng · Thêm/bớt thành viên · Chuyển sang phòng cha khác · Xoá phòng.
// Điện thoại chỉ có menu này (không kéo thả).
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ai/web-kit/ui/kit/dropdown-menu";
import { useTranslation } from "react-i18next";
import type { OrgDialogKind } from "./OrgDialogs";

export function DeptMenu({
  id,
  name,
  onPick,
}: {
  id: string;
  name: string;
  onPick: (kind: OrgDialogKind) => void;
}) {
  const { t } = useTranslation();
  const items: [OrgDialogKind, string][] = [
    ["head", t("orgEdit.menu.head")],
    ["members", t("orgEdit.menu.members")],
    ["move", t("orgEdit.menu.move")],
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid={`org-menu-${id}`}
          aria-label={t("orgEdit.menu.open", { name })}
          title={t("orgEdit.menu.title")}
          className="flex size-7 items-center justify-center rounded-md text-base leading-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none max-sm:size-9"
        >
          ⋯
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" data-testid={`org-menu-list-${id}`}>
        {items.map(([k, label]) => (
          <DropdownMenuItem key={k} data-testid={`org-menu-${k}`} onSelect={() => onPick(k)}>
            {label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem danger data-testid="org-menu-delete" onSelect={() => onPick("delete")}>
          {t("orgEdit.menu.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
