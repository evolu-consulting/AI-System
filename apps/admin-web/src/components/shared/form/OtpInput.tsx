// ADM-FR-08 · M4-R16 · ô nhập mã 6 số: MỘT <input> thật (e2e `textbox`), 6 ô chỉ là hình vẽ CSS (plan-frontend D3).
// Tự gọi `onComplete` khi đủ 6 số (mỗi lần chuyển từ chưa đủ → đủ, so với `value` hiện tại — nơi dùng xoá ô thì lần sau gửi lại).
import { cn } from "@/lib/utils";
import { isOtpComplete, OTP_LENGTH, sanitizeOtp } from "./otp";

type Props = {
  id: string;
  /** Tên truy cập (nhãn của ô nhập). */
  label: string;
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  "aria-describedby"?: string;
  className?: string;
};

export function OtpInput({
  id,
  label,
  value,
  onChange,
  onComplete,
  disabled,
  invalid,
  autoFocus,
  "aria-describedby": describedBy,
  className,
}: Props) {
  const handle = (raw: string) => {
    const next = sanitizeOtp(raw);
    onChange(next);
    if (isOtpComplete(next) && next !== value) onComplete?.(next);
  };
  return (
    <div
      className={cn(
        "relative inline-flex gap-2 rounded-md focus-within:ring-[3px] focus-within:ring-ring/50",
        className,
      )}
    >
      {Array.from({ length: OTP_LENGTH }, (_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: ô cố định theo vị trí
          key={i}
          aria-hidden
          data-active={
            !disabled && i === Math.min(value.length, OTP_LENGTH - 1) ? "true" : undefined
          }
          className={cn(
            "flex h-11 w-10 items-center justify-center rounded-md border bg-background text-lg font-medium tabular-nums data-[active=true]:border-ring",
            invalid && "border-danger",
            disabled && "opacity-50",
          )}
        >
          {value[i] ?? ""}
        </span>
      ))}
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={OTP_LENGTH}
        aria-label={label}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        // biome-ignore lint/a11y/noAutofocus: màn nhập mã chỉ có ô này
        autoFocus={autoFocus}
        disabled={disabled}
        value={value}
        onChange={(e) => handle(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-text bg-transparent text-transparent caret-transparent opacity-0 outline-none"
      />
    </div>
  );
}
