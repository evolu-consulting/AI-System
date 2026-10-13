// HUB-FR-68 · AC-H4b1-04 · secret đang được dùng nên không xoá được: liệt kê nơi dùng, chỉ nút [Đóng].
import type { SecretUsedBy } from "@ai/contracts/hub-admin";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "#/components/ui/alert-dialog";
import { UsedByList } from "./UsedByCell";

export type InUse = { name: string; usedBy: readonly SecretUsedBy[] };

export function InUseDialog({ value, onClose }: { value: InUse | null; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={value !== null} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("secrets.inUse.title", { name: value?.name ?? "" })}
          </AlertDialogTitle>
          <AlertDialogDescription>{t("secrets.inUse.body")}</AlertDialogDescription>
        </AlertDialogHeader>
        <UsedByList items={value?.usedBy ?? []} />
        <AlertDialogFooter>
          <AlertDialogCancel>{t("secrets.inUse.close")}</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
