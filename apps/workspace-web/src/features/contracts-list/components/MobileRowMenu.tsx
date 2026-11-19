// CR-180: menu «⋯» của thẻ HĐ trên điện thoại — Xem / Xoá (gom khỏi góc phải dưới, nơi nút trợ lý nổi che).
import type { ContractListRow } from "@ai/contracts/pack-contracts";
import { Button } from "@ai/web-kit/ui/kit/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ai/web-kit/ui/kit/dropdown-menu";
import { ICONS } from "@ai/web-kit/ui/kit/icons";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { deleteAction } from "../lib/delete-action";
import { EyeIcon } from "./ChildRows";

export function MobileRowMenu({
  r,
  onDelete,
  onVerify,
}: {
  r: ContractListRow;
  onDelete?: ((id: string) => void) | undefined;
  onVerify?: ((r: { id: string; title: string }) => void) | undefined;
}) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const del = deleteAction(r);
  const More = ICONS.moreActions;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("contracts.list.rowMore")}
          data-testid="row-more"
          className="mt-1.5 shrink-0"
        >
          <More />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          data-testid="row-view"
          data-contract={r.title}
          onSelect={() => void nav({ to: "/contracts/c/$id", params: { id: r.id } })}
        >
          <EyeIcon />
          {t("contracts.list.viewContract")}
        </DropdownMenuItem>
        {onVerify && (
          <DropdownMenuItem data-testid="row-verify" onSelect={() => onVerify(r)}>
            <ICONS.search className="size-4" />
            {t("contracts.verify.rowItem")}
          </DropdownMenuItem>
        )}
        {del !== "hidden" && (
          <DropdownMenuItem
            danger
            data-testid="row-delete"
            data-contract={r.title}
            disabled={del === "versions"}
            onSelect={() => onDelete?.(r.id)}
          >
            <ICONS.remove className="size-4" />
            <span className="flex min-w-0 flex-col">
              <span>{t("contracts.list.deleteContract")}</span>
              {del === "versions" && (
                <span className="text-xs text-muted-foreground">
                  {t("contracts.del.hasVersions")}
                </span>
              )}
            </span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
