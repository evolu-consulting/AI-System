// HUB-FR-68 · HUB-BR-30 · D3/D4 · ô giá trị chỉ ghi: type=password, nút Hiện/Ẩn chỉ cho giá trị đang gõ (mẫu Admin SecretField).
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { FieldFrame } from "./FieldFrame";

type Props = {
  registration: UseFormRegisterReturn;
  /** Chỉ hiện nút Hiện/Ẩn khi ô đang có chữ. */
  hasValue: boolean;
  disabled?: boolean;
  error?: string;
};

export function SecretValueField({ registration, hasValue, disabled, error }: Props) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  const reveal = shown && hasValue;
  return (
    <FieldFrame
      id="secret-value"
      label={t("secrets.field.value")}
      hint={t("secrets.field.hint")}
      error={error}
    >
      {(p) => (
        <div className="relative">
          <Input
            {...p}
            {...registration}
            type={reveal ? "text" : "password"}
            autoComplete="new-password"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            disabled={disabled}
            className="pr-10 font-mono"
          />
          {hasValue && !disabled ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t(reveal ? "secrets.field.hide" : "secrets.field.show")}
              onClick={() => setShown((v) => !v)}
              className="absolute top-1/2 right-1 -translate-y-1/2"
            >
              {reveal ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
            </Button>
          ) : null}
        </div>
      )}
    </FieldFrame>
  );
}
