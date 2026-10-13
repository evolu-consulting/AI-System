// HUB-FR-66 · AC-H4b2-03 · D8: provider/profile đang được dùng nên không xoá được; badge tên các mục đang dùng, chỉ [Đóng].
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
import { Badge } from "#/components/ui/badge";

export type InUse = { key: string; refs: readonly { id: string; key: string }[] };

export function InUseDialog({
  value,
  titleKey,
  bodyKey,
  onClose,
}: {
  value: InUse | null;
  titleKey: string;
  bodyKey: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={value !== null} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t(titleKey, { key: value?.key ?? "" })}</AlertDialogTitle>
          <AlertDialogDescription>{t(bodyKey)}</AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="flex flex-wrap gap-2">
          {(value?.refs ?? []).map((r) => (
            <li key={r.id}>
              <Badge variant="secondary" className="font-mono">
                {r.key}
              </Badge>
            </li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.close")}</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
