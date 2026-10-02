// ADM-FR-62 · M3-R02 · đầu editor Group: tên, "{tenant} · {mã}", tóm tắt, nhãn beta; nút `Đổi tên` và menu `⋯` (Xoá, không có ở beta-testers).
import type { Group } from "@ai/contracts";
import { MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { pickLocalized } from "@/lib/localized";

type Props = { group: Group; onRename: () => void; onDelete: () => void };

export function GroupHeader({ group, onRename, onDelete }: Props) {
  const { t, i18n } = useTranslation();
  const actions = (
    <>
      <Button variant="outline" onClick={onRename}>
        {t("groups.rename.button")}
      </Button>
      {group.is_beta ? null : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t("common.moreActions")}>
              <MoreHorizontal aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              {t("groups.menu.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );
  return (
    <>
      <PageHeader
        title={pickLocalized(group.name, i18n.language)}
        description={`${group.tenant_name} · ${group.tenant_key}`}
        actions={actions}
      />
      <div className="-mt-3 mb-4 space-y-1 text-body text-muted-foreground">
        <p>{t("groups.summary", { members: group.member_count, features: group.feature_count })}</p>
        {group.is_beta ? <p>{t("groups.beta.hint")}</p> : null}
        {group.description && group.description !== t("groups.beta.hint") ? (
          <p>{group.description}</p>
        ) : null}
      </div>
    </>
  );
}
