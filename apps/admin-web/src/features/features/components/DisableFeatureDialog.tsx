// ADM-FR-33 · ADM-BR-06 · kill switch mức vừa: "Tắt {feature}?" nêu số command biến khỏi menu và số người bị ảnh hưởng.
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";

export type DisableTarget = {
  /** Tên hiển thị theo ngôn ngữ đang dùng. */
  name: string;
  commands: number;
  /** `affected_user_count`; `null` khi không nạp được (dùng câu không có số). */
  users: number | null;
};

type Props = {
  target: DisableTarget | null;
  onClose: () => void;
  onConfirm: () => Promise<void>;
};

export function DisableFeatureDialog({ target, onClose, onConfirm }: Props) {
  const { t } = useTranslation();
  const body =
    target && target.users !== null
      ? t("features.disable.body", { commands: target.commands, users: target.users })
      : t("features.disable.bodyNoCount");
  return (
    <ConfirmDialog
      open={!!target}
      onOpenChange={(open) => !open && onClose()}
      title={t("features.disable.title", { feature: target?.name ?? "" })}
      description={body}
      confirmLabel={t("features.disable.submit")}
      destructive
      onConfirm={onConfirm}
    />
  );
}
