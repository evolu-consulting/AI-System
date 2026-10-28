// ADM-FR-74 · hộp thoại "Thêm công ty đối tác" / "Đổi tên công ty": một ô Tên công ty (1..200 ký tự); 409 NAME_TAKEN hiện ngay ở ô.
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { FormField } from "@/components/shared/form/FormField";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";
import { type PartnerNameValues, partnerNameSchema } from "../lib/schemas";

type Props = {
  mode: "create" | "rename";
  initial: string;
  /** Ném lỗi để hộp thoại giữ mở; `NAME_TAKEN` hiện ở ô, lỗi khác chuyển `onError`. */
  onSubmit: (name: string) => Promise<void>;
  onError: (err: unknown) => void;
  onClose: () => void;
};

const FORM_ID = "partner-name";

export function PartnerNameDialog({ mode, initial, onSubmit, onError, onClose }: Props) {
  const { t } = useTranslation();
  const tr = useTr();
  const form = useForm<PartnerNameValues>({
    resolver: zodResolver(partnerNameSchema),
    defaultValues: { name: initial },
  });
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async (v) => {
    try {
      await onSubmit(v.name);
    } catch (err) {
      if (err instanceof ApiError && (err.code as string) === "NAME_TAKEN") {
        form.setError("name", { message: "partners.error.nameTaken" });
        return;
      }
      onError(err);
    }
  });

  return (
    <Dialog open onOpenChange={(open) => !open && !isSubmitting && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t(mode === "create" ? "partners.createTitle" : "partners.renameTitle")}
          </DialogTitle>
        </DialogHeader>
        <form id={FORM_ID} noValidate onSubmit={submit}>
          <FormField
            id={`${FORM_ID}-name`}
            label={t("partners.field.name")}
            error={errors.name?.message ? tr(errors.name.message) : undefined}
          >
            {(p) => <Input {...p} {...form.register("name")} autoComplete="off" />}
          </FormField>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form={FORM_ID} disabled={isSubmitting}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
