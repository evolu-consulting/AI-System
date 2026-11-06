// CR-111 · CR-121 c12 (Q3) · thanh chọn mức "Tắt · Xem · Sửa · Quản trị" của một app (một lựa chọn; mức thiếu feature trong catalog bị khoá).
// Không tràn khi thu gọn: nhãn cắt (`truncate`) + tooltip đầy đủ (`title`); `LevelHelp` (ⓘ) giải nghĩa mức bằng lời nghiệp vụ.
import { Info } from "lucide-react";
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
      className="grid w-full min-w-0 grid-cols-4"
      // Bấm lại mức đang chọn trả giá trị rỗng: coi như chọn lại chính nó (chuẩn hoá bộ quyền không chuẩn).
      onValueChange={(v) => onChange((v || value) as AppLevel)}
    >
      {ORDER.map((l) => {
        const label = t(`tenants.apps.level.${l}`);
        return (
          <ToggleGroupItem
            key={l}
            value={l}
            title={label}
            disabled={disabled || !available[l]}
            className="h-9 min-w-0 rounded-none px-2 first:rounded-l-md last:rounded-r-md"
          >
            <span className="min-w-0 truncate">{label}</span>
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}

/** ⓘ giải nghĩa các mức: Xem = chỉ đọc · Sửa = tạo và sửa · Quản trị = thêm cài đặt app và người dùng. */
export function LevelHelp() {
  const { t } = useTranslation();
  // MỘT định nghĩa mức (tenants.apps.levelDesc), cũng dùng ở hộp thoại vai (RoleDialog).
  const text = (["read", "write", "admin"] as const)
    .map((l) => t(`tenants.apps.levelDesc.${l}`))
    .join(" · ");
  return (
    <button
      type="button"
      title={text}
      aria-label={text}
      data-testid="level-help"
      className="inline-flex cursor-help align-middle text-muted-foreground"
    >
      <Info aria-hidden className="size-3.5" />
    </button>
  );
}
