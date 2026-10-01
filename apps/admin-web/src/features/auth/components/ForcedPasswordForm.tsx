// ADM-FR-06 · form đặt mật khẩu mới bắt buộc: mới + nhập lại (một nút Hiện/Ẩn chung), độ mạnh, không có "Bỏ qua".
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { FormField } from "@/components/shared/FormField";
import { PasswordField } from "@/components/shared/PasswordField";
import { Button } from "@/components/ui/button";
import { useTr } from "@/lib/use-translate";
import { type ForcedPasswordValues, forcedPasswordSchema } from "../lib/schemas";
import { PasswordStrength } from "./PasswordStrength";

type Props = {
  pending: boolean;
  /** Lỗi theo ô `new_password` từ server (vd PASSWORD_UNCHANGED), đã dịch. */
  newPasswordError?: string;
  onSubmit: (values: ForcedPasswordValues) => void;
};

export function ForcedPasswordForm({ pending, newPasswordError, onSubmit }: Props) {
  const { t } = useTranslation();
  const tr = useTr();
  const [revealed, setRevealed] = useState(false);
  const form = useForm<ForcedPasswordValues>({
    resolver: zodResolver(forcedPasswordSchema),
    mode: "onTouched",
    defaultValues: { new_password: "", confirm: "" },
  });
  const { errors } = form.formState;
  const msg = (m: string | undefined) => (m ? tr(m) : undefined);
  const value = form.watch("new_password");

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
      <FormField
        id="forced-new"
        label={t("password.field.new")}
        description={t("password.hint")}
        error={msg(errors.new_password?.message) ?? newPasswordError}
      >
        {(p) => (
          <PasswordField
            {...p}
            {...form.register("new_password")}
            autoComplete="new-password"
            revealed={revealed}
            onRevealedChange={setRevealed}
          />
        )}
      </FormField>
      <PasswordStrength value={value} />
      <FormField
        id="forced-confirm"
        label={t("password.field.confirm")}
        error={msg(errors.confirm?.message)}
      >
        {(p) => (
          <PasswordField
            {...p}
            {...form.register("confirm")}
            autoComplete="new-password"
            revealed={revealed}
            hideToggle
          />
        )}
      </FormField>
      <Button type="submit" className="w-full" disabled={pending} aria-disabled={pending}>
        {t("password.forced.submit")}
      </Button>
    </form>
  );
}
