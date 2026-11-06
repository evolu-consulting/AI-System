// CR-121 c16: mở từ editor (danh sách /commands đã gộp vào Công cụ AI).
// ADM-FR-20 · CR-055 · xác nhận xoá command: mức nặng, gõ lại tên; nói rõ command là danh mục chung — xoá là mất ở MỌI
// công ty — và chỉ cách bỏ khỏi một công ty (bỏ feature khỏi command / thu hồi feature của công ty).
import type { Command } from "@ai/contracts/commands";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { pickLocalized } from "@/lib/localized";

type Props = {
  target: Pick<Command, "name" | "features"> | null;
  onClose: () => void;
  onConfirm: () => Promise<void>;
};

export function CommandDeleteDialog({ target, onClose, onConfirm }: Props) {
  const { t, i18n } = useTranslation();
  const name = target?.name ?? "";
  const features = target?.features.map((f) => pickLocalized(f.name, i18n.language)).join(", ");
  return (
    <ConfirmDialog
      open={!!target}
      onOpenChange={(open) => !open && onClose()}
      title={t("commands.delete.title", { name })}
      description={t(features ? "commands.delete.body" : "commands.delete.bodyNoFeature", {
        features: features ?? "",
        name,
      })}
      confirmLabel={t("commands.delete.submit")}
      destructive
      level="heavy"
      confirmText={target?.name}
      typePrompt={t("commands.delete.typeToConfirm", { name })}
      onConfirm={onConfirm}
    />
  );
}
