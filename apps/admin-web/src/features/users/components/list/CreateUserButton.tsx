// ADM-FR-04 · nút "+ Tạo user": platform chưa chọn tenant → aria-disabled + tooltip "Chọn một tenant trước" (M1-R14).

import { Button } from "@ai/web-kit/ui/kit/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ai/web-kit/ui/kit/tooltip";
import { useTranslation } from "react-i18next";

type Props = { canCreate: boolean; onCreate: () => void };

export function CreateUserButton({ canCreate, onCreate }: Props) {
  const { t } = useTranslation();
  const button = (
    <Button aria-disabled={!canCreate} onClick={() => canCreate && onCreate()}>
      {t("users.list.create")}
    </Button>
  );
  if (canCreate) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{t("common.tenantPicker.required")}</TooltipContent>
    </Tooltip>
  );
}
