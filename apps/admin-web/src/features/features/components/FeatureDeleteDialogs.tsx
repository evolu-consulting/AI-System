// ADM-FR-30 · M2-R21 (CR-055) · hộp thoại xoá feature: xác nhận nặng (gõ key); có command chỉ thuộc feature này →
// cảnh báo liệt kê chúng (sẽ thành "chưa gắn feature"), không chặn.
import type { FeatureListItem } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import type { CommandRef } from "../lib/exclusive";

export type PendingDelete = { feature: FeatureListItem; commands: CommandRef[] };

type Props = {
  pending: PendingDelete | null;
  nameOf: (f: FeatureListItem) => string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
};

export function FeatureDeleteDialogs({ pending, nameOf, onClose, onConfirm }: Props) {
  const { t } = useTranslation();
  const f = pending?.feature;
  const lonely = pending?.commands ?? [];
  const warn =
    lonely.length > 0
      ? t("features.delete.orphanWarn", { commands: lonely.map((c) => `/${c.name}`).join(", ") })
      : undefined;
  return (
    <ConfirmDialog
      open={!!pending}
      onOpenChange={(open) => !open && onClose()}
      title={t("features.delete.title", { feature: f ? nameOf(f) : "" })}
      description={warn}
      confirmLabel={t("features.delete.submit")}
      destructive
      level="heavy"
      confirmText={f?.key}
      typePrompt={t("features.delete.typeToConfirm", { key: f?.key ?? "" })}
      onConfirm={onConfirm}
    />
  );
}
