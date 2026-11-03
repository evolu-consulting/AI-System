// CR-111 · thanh chọn mức "Tắt · Xem · Sửa · Quản trị" của một app (một lựa chọn; mức thiếu feature trong catalog bị khoá).
import { useTranslation } from "react-i18next";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { LEVELS } from "@/features/features/lib/feature-meta";
import type { AppLevel } from "../../lib/feature-assign";

type Props = {
  value: AppLevel;
  available: Record<AppLevel, boolean>;
  ariaLabel: string;
  /** Chỉ xem (tenant_admin): khoá cả thanh. */
  disabled?: boolean;
  onChange: (level: AppLevel) => void;
};

const ORDER: readonly AppLevel[] = ["off", ...LEVELS];

export function LevelControl({ value, available, ariaLabel, disabled, onChange }: Props) {
  const { t } = useTranslation();
  return (
    <ToggleGroup
      type="single"
      value={value}
      aria-label={ariaLabel}
      className="grid w-full grid-cols-4"
      // Bấm lại mức đang chọn trả giá trị rỗng: coi như chọn lại chính nó (chuẩn hoá bộ quyền không chuẩn).
      onValueChange={(v) => onChange((v || value) as AppLevel)}
    >
      {ORDER.map((l) => (
        <ToggleGroupItem
          key={l}
          value={l}
          disabled={disabled || !available[l]}
          className="h-9 rounded-none first:rounded-l-md last:rounded-r-md"
        >
          {t(`tenants.features.level.${l}`)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
