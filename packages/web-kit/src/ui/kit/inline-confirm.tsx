// CR-177 U3 · InlineConfirm: khung xác nhận tại chỗ. Có ô nhập tuỳ chọn; `required` ⇒ phải có nội dung mới bật nút xác nhận. Esc huỷ, focus vào ô khi mở.
import * as React from "react";
import { cn } from "./cn";

/** Nút xác nhận bật khi: không bắt buộc nhập, hoặc đã có chữ. */
export const canConfirm = (required: boolean, text: string): boolean =>
  !required || text.trim().length > 0;

export type InlineConfirmProps = {
  title: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Có ô nhập (lý do…). */
  inputLabel?: string;
  /** Ô nhập bắt buộc có nội dung. */
  required?: boolean;
  onConfirm: (text: string) => void;
  onCancel: () => void;
  className?: string;
  ref?: React.Ref<HTMLDivElement>;
};

export function InlineConfirm({
  title,
  confirmLabel,
  cancelLabel = "Huỷ",
  inputLabel,
  required = false,
  onConfirm,
  onCancel,
  className,
  ref,
}: InlineConfirmProps) {
  const [text, setText] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const confirmRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    (inputRef.current ?? confirmRef.current)?.focus();
  }, []);
  const ok = canConfirm(required && !!inputLabel, text);
  return (
    // biome-ignore lint/a11y/useSemanticElements: khung nhóm, không phải fieldset
    <div
      ref={ref}
      role="group"
      aria-label={title}
      data-slot="inline-confirm"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
      className={cn("flex flex-col gap-2 rounded-md border bg-muted/40 p-3 text-sm", className)}
    >
      <p className="font-medium">{title}</p>
      {inputLabel && (
        <input
          ref={inputRef}
          data-slot="inline-confirm-input"
          aria-label={inputLabel}
          placeholder={inputLabel}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && ok) onConfirm(text.trim());
          }}
          className="h-[var(--control-md)] rounded-md border border-input bg-background px-3 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          data-slot="inline-confirm-cancel"
          onClick={onCancel}
          className="h-[var(--control-sm)] rounded-md px-3 transition-colors duration-[var(--duration-fast)] hover:bg-muted"
        >
          {cancelLabel}
        </button>
        <button
          ref={confirmRef}
          type="button"
          data-slot="inline-confirm-confirm"
          disabled={!ok}
          onClick={() => onConfirm(text.trim())}
          className="h-[var(--control-sm)] rounded-md bg-primary px-3 text-primary-foreground transition-colors duration-[var(--duration-fast)] disabled:opacity-50"
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
