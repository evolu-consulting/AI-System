// ADM-FR-06 · "Độ mạnh: {mức}" (aria-live polite). Chỉ gợi ý.
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { passwordStrength } from "../lib/strength";

const TONE = { weak: "text-destructive", medium: "text-warning", strong: "text-success" } as const;

export function PasswordStrength({ value }: { value: string }) {
  const { t } = useTranslation();
  if (!value) return null;
  const level = passwordStrength(value);
  return (
    <output aria-live="polite" className={cn("block text-caption font-medium", TONE[level])}>
      {t("password.strength.label", { level: t(`password.strength.${level}`) })}
    </output>
  );
}
