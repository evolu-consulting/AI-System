// ADM-FR-62 · ADM-FR-55 · hộp thoại "Đổi tên group": chỉ Tên (VI/EN) và Mô tả; 409 → ConflictDialog.
import type { Group } from "@ai/contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormProvider, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useOnline } from "@/components/shared/ConnectionBanner";
import { LazyConflictDialog } from "@/components/shared/conflict/LazyConflictDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useGroupConflict } from "../../hooks/use-group-conflict";
import { type GroupFormValues, groupRenameSchema, toFormValues } from "../../lib/schemas";
import { GroupFields } from "./GroupFields";

type Props = { group: Group; open: boolean; onClose: () => void; onReload: () => void };

export function GroupRenameDialog({ group, open, onClose, onReload }: Props) {
  const { t } = useTranslation();
  const online = useOnline();
  const form = useForm<GroupFormValues>({
    resolver: zodResolver(groupRenameSchema as never) as never,
    defaultValues: toFormValues(group),
  });
  const conflict = useGroupConflict(group, {
    onSaved: onClose,
    onReload: () => {
      onReload();
      onClose();
    },
  });
  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("groups.rename.title")}</DialogTitle>
          </DialogHeader>
          <FormProvider {...form}>
            <form
              id="group-rename"
              noValidate
              onSubmit={form.handleSubmit((v) => void conflict.save(v))}
            >
              <GroupFields withKey={false} idPrefix="group-rename" />
            </form>
          </FormProvider>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" form="group-rename" disabled={conflict.pending || !online}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <LazyConflictDialog props={conflict.props} />
    </>
  );
}
