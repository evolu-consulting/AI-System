// ADM-FR-62 · M3-R04 · hộp thoại xoá group mức nặng: nêu số thành viên/feature, gõ lại key để bật nút.
import type { GroupListItem } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { pickLocalized } from "@/lib/localized";

type Props = { target: GroupListItem | null; onClose: () => void; onConfirm: () => Promise<void> };

export function GroupDeleteDialog({ target, onClose, onConfirm }: Props) {
  const { t, i18n } = useTranslation();
  const name = target ? pickLocalized(target.name, i18n.language) : "";
  return (
    <ConfirmDialog
      open={target !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t("groups.delete.title", { name })}
      description={t("groups.delete.body", {
        members: target?.member_count ?? 0,
        features: target?.feature_count ?? 0,
      })}
      confirmLabel={t("groups.delete.submit")}
      destructive
      level="heavy"
      confirmText={target?.key}
      typePrompt={t("groups.delete.typeToConfirm", { key: target?.key ?? "" })}
      onConfirm={onConfirm}
    />
  );
}
