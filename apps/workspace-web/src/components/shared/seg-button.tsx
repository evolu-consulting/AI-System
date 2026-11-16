// V2-F · mockup `.seg` / `.kp button`: nút chọn một trong nhóm (radiogroup tuỳ biến dạng nút) — loại HĐ, lỗi của ai, việc của ai.
// CR-177 W1: mũi tên ←→↑↓ (Home/End) chuyển và chọn nút kế trong cùng `role=radiogroup`. Kit chưa có mục radio đứng riêng (RadioGroupItem cần Root) ⇒ làm tạm ở đây.
import type { KeyboardEvent, ReactNode } from "react";
import { cn } from "~/lib/utils";

/** Chỉ số nút cần chuyển tới khi bấm `key` ở nút `at` trong nhóm `n` nút; `null` = phím không phải mũi tên. Đi vòng. */
export function radioStep(key: string, at: number, n: number): number | null {
  if (n <= 0 || at < 0) return null;
  if (key === "ArrowRight" || key === "ArrowDown") return (at + 1) % n;
  if (key === "ArrowLeft" || key === "ArrowUp") return (at - 1 + n) % n;
  if (key === "Home") return 0;
  if (key === "End") return n - 1;
  return null;
}

function onArrow(e: KeyboardEvent<HTMLButtonElement>) {
  const group = e.currentTarget.closest<HTMLElement>('[role="radiogroup"]');
  if (!group) return;
  const radios = [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)')];
  const to = radioStep(e.key, radios.indexOf(e.currentTarget), radios.length);
  if (to === null) return;
  e.preventDefault();
  radios[to]?.focus();
  radios[to]?.click();
}

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
      onKeyDown={onArrow}
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
