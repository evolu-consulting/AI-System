// ADM-FR-06 · form tự đổi mật khẩu: hiện tại + mới + nhập lại; lỗi server gắn vào ô tương ứng.
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { FormField } from "@/components/shared/FormField";
import { PasswordField } from "@/components/shared/PasswordField";
import { Button } from "@/components/ui/button";
import { useTr } from "@/lib/use-translate";
import { type SelfPasswordValues, selfPasswordSchema } from "../lib/schemas";
import { PasswordStrength } from "./PasswordStrength";

export type SelfPasswordServerErrors = { current?: string; next?: string };

type Props = {
  pending: boolean;
  serverErrors: SelfPasswordServerErrors;
  onCancel: () => void;
  onSubmit: (values: SelfPasswordValues) => void;
};

export function SelfPasswordForm({ pending, serverErrors, onCancel, onSubmit }: Props) {
  const { t } = useTranslation();
  const tr = useTr();
  const [revealed, setRevealed] = useState(false);
  const form = useForm<SelfPasswordValues>({
    resolver: zodResolver(selfPasswordSchema),
    mode: "onTouched",
    defaultValues: { current_password: "", new_password: "", confirm: "" },
  });
  const { errors } = form.formState;
  const msg = (m: string | undefined) => (m ? tr(m) : undefined);

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
      <FormField
        id="self-current"
        label={t("password.field.current")}
        error={msg(errors.current_password?.message) ?? serverErrors.current}
      >
        {(p) => (
          <PasswordField
            {...p}
            {...form.register("current_password")}
            autoComplete="current-password"
            revealed={revealed}
            hideToggle
          />
        )}
      </FormField>
      <FormField
        id="self-new"
        label={t("password.field.new")}
        description={t("password.hint")}
        error={msg(errors.new_password?.message) ?? serverErrors.next}
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
      <PasswordStrength value={form.watch("new_password")} />
      <FormField
        id="self-confirm"
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
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={pending} aria-disabled={pending}>
          {t("password.self.submit")}
        </Button>
      </div>
    </form>
  );
}
