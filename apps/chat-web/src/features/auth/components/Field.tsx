// CHAT-AC-01 · một ô form: `<label>` thật + gợi ý + lỗi gắn `aria-describedby` (a11y, e2e chọn theo nhãn).
import type { ReactNode } from "react";
import { Label } from "~/components/ui/label";

export type FieldControlProps = {
  id: string;
  "aria-invalid": boolean;
  "aria-describedby"?: string;
};

type Props = {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  /** Phần tử bên phải nhãn (vd nút "Đổi công ty"). */
  action?: ReactNode;
  children: (p: FieldControlProps) => ReactNode;
};

export function Field({ id, label, hint, error, action, children }: Props) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id} className="text-label text-foreground">
          {label}
        </Label>
        {action}
      </div>
      {children({ id, "aria-invalid": Boolean(error), "aria-describedby": describedBy })}
      {error ? (
        <p id={errorId} className="text-caption text-danger">
          {error}
        </p>
      ) : null}
      {hint && !error ? (
        <p id={hintId} className="text-caption text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
