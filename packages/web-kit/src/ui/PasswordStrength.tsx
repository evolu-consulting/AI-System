// CR-187 · «Độ mạnh: {mức}» hiện khi gõ mật khẩu mới — DÙNG CHUNG admin-web + workspace-web (luật ở `password-strength.ts`).
// Chuỗi do app truyền (web-kit không giữ i18n). Chỉ gợi ý, không chặn.
import { passwordStrength, type Strength } from "../password-strength";
import { cn } from "./kit/cn";

const TONE = { weak: "text-destructive", medium: "text-warning", strong: "text-success" } as const;

export function PasswordStrength({
  value,
  label,
}: {
  value: string;
  /** Nhãn đầy đủ theo mức, vd «Độ mạnh: Yếu». */
  label: (level: Strength) => string;
}) {
  if (!value) return null;
  const level = passwordStrength(value);
  return (
    <output aria-live="polite" className={cn("block text-caption font-medium", TONE[level])}>
      {label(level)}
    </output>
  );
}
