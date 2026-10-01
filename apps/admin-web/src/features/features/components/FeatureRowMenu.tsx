// ADM-FR-30, ADM-FR-33 · menu `⋯` của một feature: Sửa · Bật · Chuyển sang Beta · Tắt · Xoá (`core` chỉ có Sửa).
import type { FeatureListItem } from "@ai/contracts";
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
import type { FeatureStatusFilter } from "../api";

type Props = {
  feature: FeatureListItem;
  onStatus: (f: FeatureListItem, status: FeatureStatusFilter) => void;
  onDelete: (f: FeatureListItem) => void;
};

export function FeatureRowMenu({ feature, onStatus, onDelete }: Props) {
  const { t } = useTranslation();
  const s = feature.status;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("common.moreActions")}>
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link to="/features/$featureId" params={{ featureId: feature.id }}>
            {t("workflows.menu.edit")}
          </Link>
        </DropdownMenuItem>
        {feature.is_core ? null : (
          <>
            {s === "on" ? null : (
              <DropdownMenuItem onSelect={() => onStatus(feature, "on")}>
                {t("common.on")}
              </DropdownMenuItem>
            )}
            {s === "beta" ? null : (
              <DropdownMenuItem onSelect={() => onStatus(feature, "beta")}>
                {t("features.menu.toBeta")}
              </DropdownMenuItem>
            )}
            {s === "off" ? null : (
              <DropdownMenuItem onSelect={() => onStatus(feature, "off")}>
                {t("common.off")}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => onDelete(feature)}>
              {t("workflows.menu.delete")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
