// ADM-FR-75 · hộp thoại "Thêm tài khoản" của công ty đối tác: Tên đăng nhập, Tên hiển thị, Email (không bắt buộc), Ngôn ngữ. Role luôn `member`.
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";
import { type PartnerUserValues, partnerUserSchema } from "../lib/schemas";

type Props = {
  /** Ném lỗi để hộp thoại giữ mở; USERNAME_TAKEN / EMAIL_TAKEN hiện ở ô, lỗi khác chuyển `onError`. */
  onSubmit: (v: {
    username: string;
    display_name: string;
    email: string | null;
    locale: "vi" | "en";
  }) => Promise<void>;
  onError: (err: unknown) => void;
  onClose: () => void;
};

const FORM_ID = "partner-user";
const FIELD_BY_CODE: Record<string, "username" | "email"> = {
  USERNAME_TAKEN: "username",
  EMAIL_TAKEN: "email",
};

export function PartnerUserDialog({ onSubmit, onError, onClose }: Props) {
  const { t } = useTranslation();
  const tr = useTr();
  const form = useForm<PartnerUserValues>({
    resolver: zodResolver(partnerUserSchema),
    mode: "onTouched",
    defaultValues: { username: "", display_name: "", email: "", locale: "vi" },
  });
  const { errors, isSubmitting } = form.formState;
  const msg = (m: string | undefined) => (m ? tr(m) : undefined);

  const submit = form.handleSubmit(async (v) => {
    try {
      await onSubmit({ ...v, email: v.email === "" ? null : v.email });
    } catch (err) {
      const field = err instanceof ApiError ? FIELD_BY_CODE[err.code] : undefined;
      if (field) {
        const spec = describeError(err);
        form.setError(field, { message: spec.key });
        return;
      }
      onError(err);
    }
  });

  return (
    <Dialog open onOpenChange={(open) => !open && !isSubmitting && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("partners.user.addTitle")}</DialogTitle>
        </DialogHeader>
        <form id={FORM_ID} noValidate onSubmit={submit} className="space-y-4">
          <FormField
            id={`${FORM_ID}-username`}
            label={t("users.field.username")}
            error={msg(errors.username?.message)}
          >
            {(p) => (
              <Input
                {...p}
                {...form.register("username")}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
              />
            )}
          </FormField>
          <FormField
            id={`${FORM_ID}-display`}
            label={t("users.field.displayName")}
            error={msg(errors.display_name?.message)}
          >
            {(p) => <Input {...p} {...form.register("display_name")} autoComplete="off" />}
          </FormField>
          <FormField
            id={`${FORM_ID}-email`}
            label={`${t("users.field.email")} (${t("partners.user.optional")})`}
            error={msg(errors.email?.message)}
          >
            {(p) => <Input {...p} {...form.register("email")} type="email" autoComplete="off" />}
          </FormField>
          <FormField id={`${FORM_ID}-locale`} label={t("users.field.locale")}>
            {(p) => (
              <Select
                value={form.watch("locale")}
                onValueChange={(v) => form.setValue("locale", v as "vi" | "en")}
              >
                <SelectTrigger {...p} className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vi">{t("auth.lang.vi")}</SelectItem>
                  <SelectItem value="en">{t("auth.lang.en")}</SelectItem>
                </SelectContent>
              </Select>
            )}
          </FormField>
          <p className="text-caption text-muted-foreground">{t("users.create.passwordNote")}</p>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form={FORM_ID} disabled={isSubmitting}>
            {t("partners.user.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
