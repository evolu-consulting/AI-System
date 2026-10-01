// ADM-FR-50 · M2-R03 · ô giá trị secret: type=password, nút Hiện/Ẩn chỉ tác động giá trị đang gõ (D10).
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { FormField } from "@/components/shared/form/FormField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Props = {
  id: string;
  label: string;
  registration: UseFormRegisterReturn;
  /** Chỉ hiện nút Hiện/Ẩn khi ô đang có chữ. */
  hasValue: boolean;
  description?: string;
  error?: string;
};

export function SecretField({ id, label, registration, hasValue, description, error }: Props) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  return (
    <FormField id={id} label={label} description={description} error={error}>
      {(p) => (
        <div className="relative">
          <Input
            {...p}
            {...registration}
            type={shown ? "text" : "password"}
            autoComplete="new-password"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className="pr-10 font-mono"
          />
          {hasValue ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={shown ? t("secrets.field.hide") : t("secrets.field.show")}
              onClick={() => setShown((v) => !v)}
              className="absolute top-1/2 right-1 -translate-y-1/2"
            >
              {shown ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
            </Button>
          ) : null}
        </div>
      )}
    </FormField>
  );
}
