// ADM-FR-50 · M2-R05 · hộp thoại xoá secret: chặn (liệt kê workflow đang dùng) hoặc xác nhận nặng (gõ lại tên). Không có giá trị secret (D10).
import { useTranslation } from "react-i18next";
import { BlockedDialog } from "@/components/shared/BlockedDialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { DependencyList } from "@/components/shared/DependencyList";

export type DeleteTarget = { name: string; usedBy: string[]; blocked: boolean };

type Props = {
  target: DeleteTarget | null;
  onClose: () => void;
  onConfirm: () => Promise<void>;
};

export function SecretDeleteDialogs({ target, onClose, onConfirm }: Props) {
  const { t } = useTranslation();
  const name = target?.name ?? "";
  return (
    <>
      <BlockedDialog
        open={!!target?.blocked}
        onClose={onClose}
        title={t("secrets.delete.blocked", { name })}
      >
        <DependencyList
          sections={[
            {
              title: t("common.dependency.workflow"),
              items: (target?.usedBy ?? []).map((key) => ({
                id: key,
                label: key,
                mono: true,
                href: "/workflows",
                search: { q: key },
              })),
            },
          ]}
        />
      </BlockedDialog>
      <ConfirmDialog
        open={!!target && !target.blocked}
        onOpenChange={(open) => !open && onClose()}
        title={t("secrets.delete.title", { name })}
        confirmLabel={t("secrets.delete.submit")}
        destructive
        level="heavy"
        confirmText={name}
        typePrompt={t("secrets.delete.typeToConfirm", { name })}
        onConfirm={onConfirm}
      />
    </>
  );
}
