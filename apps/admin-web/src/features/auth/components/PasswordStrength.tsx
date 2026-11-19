// ADM-FR-06 · "Độ mạnh: {mức}": phần hiển thị + luật nằm ở web-kit (CR-187, dùng chung); đây chỉ gắn chuỗi i18n của Admin.
import { PasswordStrength as Shared } from "@ai/web-kit/ui/PasswordStrength";
import { useTranslation } from "react-i18next";

export function PasswordStrength({ value }: { value: string }) {
  const { t } = useTranslation();
  return (
    <Shared
      value={value}
      label={(level) => t("password.strength.label", { level: t(`password.strength.${level}`) })}
    />
  );
}
