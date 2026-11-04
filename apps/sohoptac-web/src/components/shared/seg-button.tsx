// V2-F · mockup `.seg` / `.kp button`: nút chọn một trong nhóm (radiogroup tuỳ biến dạng nút) — loại HĐ, lỗi của ai, việc của ai.
import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

export function SegButton({
  checked,
  onClick,
  disabled,
  className,
  children,
}: {
  checked: boolean;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: nút dạng radio theo mockup NITI; <input type=radio> ẩn sẽ mất kiểu dáng ô chọn
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onClick}
      className={className}
    >
      {children}
    </button>
  );
}

/** Nút nhỏ dạng viên (hàng "Việc của", "Lỗi của ai"): chọn = viền + nền tím nhạt. */
export function PillRadio({
  checked,
  onClick,
  children,
}: {
  checked: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <SegButton
      checked={checked}
      onClick={onClick}
      className={cn(
        "h-9 rounded-lg border px-3 text-[13px]",
        checked ? "border-act bg-act-soft font-semibold text-act" : "border-field bg-panel",
      )}
    >
      {children}
    </SegButton>
  );
}
