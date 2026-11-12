// CR-134 · MỘT component nút cho workspace-web (thay shadcn `button.tsx` + `className="btn …"` rải rác).
// Quy ước: các nút đứng CÙNG HÀNG dùng cùng `size` (md = 40px mặc định, sm = 36px cho thanh gọn/dòng bảng).
// Q7: thao tác người xem không có quyền ⇒ `disabled` + `reason` (tooltip khi rê chuột + `aria-describedby`); thao tác vai đó
// không bao giờ có ⇒ KHÔNG render nút. Gắn trên các lớp `.btn*` của globals.css (một nguồn cỡ/màu).
import { type ButtonHTMLAttributes, forwardRef, useId } from "react";
import { cn } from "~/lib/utils";

export type BtnVariant = "primary" | "outline" | "quiet" | "danger" | "icon";
export type BtnSize = "md" | "sm";

const VARIANT: Record<BtnVariant, string> = {
  primary: "btn btn-primary",
  outline: "btn btn-outline",
  quiet: "btn btn-quiet",
  danger: "btn btn-danger",
  icon: "btn-icon-ghost",
};

/** Lớp CSS của nút — cho phần tử không phải <button> (Link, span trong Link) cần cùng cỡ/màu. */
export function btnClass(variant: BtnVariant = "quiet", size: BtnSize = "md"): string {
  return cn(VARIANT[variant], size === "sm" && variant !== "icon" && "btn-sm");
}

export type BtnProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "disabled"> & {
  variant?: BtnVariant;
  size?: BtnSize;
  /** Đang xử lý: khoá nút + vòng quay + aria-busy. */
  loading?: boolean;
  disabled?: boolean;
  /** Lý do khoá (chỉ hiện khi `disabled`): tooltip khi rê chuột + đọc được bằng trình đọc màn hình. */
  reason?: string | undefined;
};

export const Btn = forwardRef<HTMLButtonElement, BtnProps>(function Btn(
  {
    variant = "quiet",
    size = "md",
    loading = false,
    disabled = false,
    reason,
    className,
    children,
    type = "button",
    ...rest
  },
  ref,
) {
  "use no memo"; // component nhỏ, render rẻ: bỏ bộ nhớ đệm của React Compiler cho chunk gọn (check:bundle)
  const reasonId = useId();
  const off = disabled || loading;
  const why = disabled && reason ? reason : undefined;
  const button = (
    <button
      ref={ref}
      {...rest}
      type={type}
      className={cn(btnClass(variant, size), className)}
      disabled={off}
      aria-busy={loading || undefined}
      aria-describedby={why ? reasonId : rest["aria-describedby"]}
    >
      {loading && (
        <span
          aria-hidden="true"
          className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  );
  if (!why) return button;
  // Nút `disabled` không nhận sự kiện chuột ⇒ bọc span để tooltip hiện khi rê.
  return (
    <span title={why} className="inline-flex cursor-not-allowed">
      {button}
      <span id={reasonId} className="sr-only">
        {why}
      </span>
    </span>
  );
});
